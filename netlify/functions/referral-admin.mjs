// Private endpoint for the referral-code manager (referral-admin.html).
// Every request must send the REFERRAL_ADMIN_PASSWORD in the x-admin-password header.
import { randomUUID } from "node:crypto";
import {
  BREAK_MINUTES,
  PACKAGE_PRICES,
  clashes,
  cleanText,
  codesStore,
  formatMinutes,
  inquiriesStore,
  isCodeUsable,
  isISODate,
  isMinute,
  isValidCodeFormat,
  jsonResponse,
  normalizeCode,
  packageIdFromName,
  passwordMatches,
  readSchedule,
  scheduleStore,
  vancouverToday
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
    const schedule = await scheduleStore();

    switch (body?.action) {
      case "list": {
        const codeKeys = (await codes.list()).blobs.map((b) => b.key);
        const codeList = (await Promise.all(codeKeys.map((k) => codes.get(k, { type: "json" })))).filter(Boolean);

        const inquiryKeys = (await inquiries.list()).blobs.map((b) => b.key).sort().reverse();
        const inquiryList = (
          await Promise.all(inquiryKeys.slice(0, 300).map((k) => inquiries.get(k, { type: "json" })))
        )
          .filter(Boolean)
          // Inquiries ticked before booking times existed never blocked anything: treat as not booked.
          .map((i) => (i.booked && !i.bookedDate ? { ...i, booked: false, needsTime: true } : i));

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
              booked: used.filter((i) => i.booked && i.bookedDate).length
            };
          })
          .sort((a, b) => a.code.localeCompare(b.code));

        const today = vancouverToday();
        const upcoming = (await readSchedule())
          .filter((e) => e.date >= today)
          .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);

        return jsonResponse(200, {
          codes: withStats,
          inquiries: inquiryList,
          schedule: upcoming,
          packageMinutes: Object.fromEntries(Object.entries(PACKAGE_PRICES).map(([k, v]) => [k, v.minutes])),
          breakMinutes: BREAK_MINUTES
        });
      }

      case "saveCode": {
        const code = normalizeCode(body.code);
        const partner = cleanText(body.partner, 80);
        const type = body.type === "amount" ? "amount" : "percent";
        const percent = Number(body.percent);
        const amount = Math.round(Number(body.amount) * 100) / 100;
        const expires = cleanText(body.expires, 10);
        if (!isValidCodeFormat(code)) {
          return jsonResponse(400, { message: "Codes use 3–24 letters, numbers, or dashes (e.g. SARAH15)." });
        }
        if (!partner) return jsonResponse(400, { message: "Enter who the code belongs to." });
        if (type === "percent" && (!Number.isInteger(percent) || percent < 1 || percent > 90)) {
          return jsonResponse(400, { message: "A % discount must be a whole number from 1 to 90." });
        }
        if (type === "amount" && (!Number.isFinite(amount) || amount <= 0 || amount > 500)) {
          return jsonResponse(400, { message: "A $ discount must be between $1 and $500." });
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
          type,
          ...(type === "percent" ? { percent } : { amount }),
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

      case "book": {
        const id = cleanText(body.id, 80);
        const inquiry = id ? await inquiries.get(id, { type: "json" }) : null;
        if (!inquiry) return jsonResponse(404, { message: "Inquiry not found." });
        const date = body.date;
        const start = body.start;
        if (!isISODate(date) || !isMinute(start)) {
          return jsonResponse(400, { message: "Enter the date and start time you agreed with the client." });
        }
        const pkgId = inquiry.packageId || packageIdFromName(inquiry.package);
        const minutes = PACKAGE_PRICES[pkgId]?.minutes;
        if (!minutes) return jsonResponse(400, { message: "Unknown package length for this inquiry." });
        const end = start + minutes;
        if (end > 1440) return jsonResponse(400, { message: "That session would run past midnight." });

        const sameDay = (await readSchedule()).filter((e) => e.date === date);
        const clash = clashes(sameDay, start, end, id);
        if (clash) {
          return jsonResponse(409, {
            message: `That overlaps ${clash.label || "another booking"} (${formatMinutes(clash.start)}–${formatMinutes(clash.end)}) including your ${BREAK_MINUTES}-minute break.`
          });
        }

        await schedule.setJSON(id, {
          id,
          date,
          start,
          end,
          kind: "session",
          label: `${inquiry.name} · ${inquiry.package}`
        });
        Object.assign(inquiry, { booked: true, bookedDate: date, bookedStart: start, bookedEnd: end });
        await inquiries.setJSON(id, inquiry);
        return jsonResponse(200, { inquiry });
      }

      case "unbook": {
        const id = cleanText(body.id, 80);
        const inquiry = id ? await inquiries.get(id, { type: "json" }) : null;
        if (!inquiry) return jsonResponse(404, { message: "Inquiry not found." });
        await schedule.delete(id);
        Object.assign(inquiry, { booked: false, bookedDate: null, bookedStart: null, bookedEnd: null });
        await inquiries.setJSON(id, inquiry);
        return jsonResponse(200, { inquiry });
      }

      case "block": {
        const date = body.date;
        const wholeDay = Boolean(body.wholeDay);
        const start = wholeDay ? 0 : body.start;
        const end = wholeDay ? 1440 : body.end;
        if (!isISODate(date)) return jsonResponse(400, { message: "Choose a date to block." });
        if (!isMinute(start) || !isMinute(end) || end <= start) {
          return jsonResponse(400, { message: "Enter a start and end time, with the end after the start." });
        }
        const id = `block-${randomUUID().slice(0, 12)}`;
        const entry = { id, date, start, end, kind: "block", label: cleanText(body.note, 80) || "Blocked" };
        await schedule.setJSON(id, entry);
        return jsonResponse(200, { entry });
      }

      case "unblock": {
        const id = cleanText(body.id, 80);
        if (!id.startsWith("block-")) return jsonResponse(400, { message: "Only manual blocks can be removed here." });
        await schedule.delete(id);
        return jsonResponse(200, { deleted: id });
      }

      case "deleteInquiry": {
        const id = cleanText(body.id, 80);
        if (!id) return jsonResponse(400, { message: "Unknown inquiry." });
        await inquiries.delete(id);
        await schedule.delete(id);
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
