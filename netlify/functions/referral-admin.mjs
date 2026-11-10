// Private endpoint for the referral-code manager (referral-admin.html).
// Every request must send the REFERRAL_ADMIN_PASSWORD in the x-admin-password header.
import {
  cleanText,
  codesStore,
  inquiriesStore,
  isCodeUsable,
  isValidCodeFormat,
  jsonResponse,
  normalizeCode,
  passwordMatches
} from "../lib/referrals.mjs";

export default async function handler(request) {
  if (request.method !== "POST") {
    return jsonResponse(405, { message: "Use POST." });
  }
  if (!process.env.REFERRAL_ADMIN_PASSWORD) {
    return jsonResponse(503, { message: "Set REFERRAL_ADMIN_PASSWORD in Netlify to use the code manager." });
  }
  if (!passwordMatches(request.headers.get("x-admin-password"))) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return jsonResponse(401, { message: "Wrong password." });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { message: "Send a valid JSON request." });
  }

  try {
    const codes = await codesStore();
    const inquiries = await inquiriesStore();

    switch (body?.action) {
      case "list": {
        const codeKeys = (await codes.list()).blobs.map((b) => b.key);
        const codeList = (await Promise.all(codeKeys.map((k) => codes.get(k, { type: "json" })))).filter(Boolean);

        const inquiryKeys = (await inquiries.list()).blobs.map((b) => b.key).sort().reverse();
        const inquiryList = (
          await Promise.all(inquiryKeys.slice(0, 300).map((k) => inquiries.get(k, { type: "json" })))
        ).filter(Boolean);

        const allForCounts = inquiryKeys.length > 300
          ? (await Promise.all(inquiryKeys.map((k) => inquiries.get(k, { type: "json" })))).filter(Boolean)
          : inquiryList;

        const withStats = codeList
          .map((c) => {
            const used = allForCounts.filter((i) => i.code === c.code);
            return {
              ...c,
              usable: isCodeUsable(c),
              inquiries: used.length,
              booked: used.filter((i) => i.booked).length
            };
          })
          .sort((a, b) => a.code.localeCompare(b.code));

        return jsonResponse(200, { codes: withStats, inquiries: inquiryList });
      }

      case "saveCode": {
        const code = normalizeCode(body.code);
        const partner = cleanText(body.partner, 80);
        const percent = Number(body.percent);
        const expires = cleanText(body.expires, 10);
        if (!isValidCodeFormat(code)) {
          return jsonResponse(400, { message: "Codes use 3–24 letters, numbers, or dashes (e.g. SARAH15)." });
        }
        if (!partner) return jsonResponse(400, { message: "Enter who the code belongs to." });
        if (!Number.isInteger(percent) || percent < 1 || percent > 90) {
          return jsonResponse(400, { message: "Discount must be a whole number from 1 to 90." });
        }
        if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
          return jsonResponse(400, { message: "Expiry must be a date." });
        }
        const existing = await codes.get(code, { type: "json" });
        if (existing && body.isNew) {
          return jsonResponse(409, { message: `${code} already exists. Edit it in the list instead.` });
        }
        const record = {
          code,
          partner,
          percent,
          expires: expires || null,
          active: body.active !== false,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await codes.setJSON(code, record);
        return jsonResponse(200, { code: record });
      }

      case "deleteCode": {
        const code = normalizeCode(body.code);
        if (!isValidCodeFormat(code)) return jsonResponse(400, { message: "Unknown code." });
        await codes.delete(code);
        return jsonResponse(200, { deleted: code });
      }

      case "setBooked": {
        const id = cleanText(body.id, 80);
        const inquiry = id ? await inquiries.get(id, { type: "json" }) : null;
        if (!inquiry) return jsonResponse(404, { message: "Inquiry not found." });
        inquiry.booked = Boolean(body.booked);
        await inquiries.setJSON(id, inquiry);
        return jsonResponse(200, { inquiry });
      }

      case "deleteInquiry": {
        const id = cleanText(body.id, 80);
        if (!id) return jsonResponse(400, { message: "Unknown inquiry." });
        await inquiries.delete(id);
        return jsonResponse(200, { deleted: id });
      }

      default:
        return jsonResponse(400, { message: "Unknown action." });
    }
  } catch (error) {
    console.error("Referral admin request failed.", error);
    return jsonResponse(502, { message: "Something went wrong talking to storage. Please try again." });
  }
}
