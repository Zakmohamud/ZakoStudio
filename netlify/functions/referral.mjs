// Public endpoint used by the booking page.
//   GET  /api/referral?code=SARAH15   -> checks a code (never lists codes)
//   POST /api/referral                -> records an inquiry (with or without a code)
import { randomUUID } from "node:crypto";
import { acknowledgementEmail, emailDetails, logEmail } from "../lib/emails.mjs";
import { mailReady, sendMail } from "../lib/mail.mjs";
import {
  PACKAGE_PRICES,
  cleanText,
  applyDiscount,
  discountLabel,
  discountOf,
  findCode,
  inquiriesStore,
  isCodeUsable,
  isISODate,
  isMinute,
  jsonResponse,
  normalizeCode,
  readSettings
} from "../lib/referrals.mjs";

export default async function handler(request) {
  if (request.method === "GET") {
    const code = normalizeCode(new URL(request.url).searchParams.get("code"));
    try {
      const record = await findCode(code);
      if (!isCodeUsable(record)) {
        return jsonResponse(200, { valid: false, message: "That code isn’t valid or has expired." });
      }
      return jsonResponse(200, { valid: true, code: record.code, ...discountOf(record) });
    } catch (error) {
      console.error("Referral code lookup failed.", error);
      return jsonResponse(502, { valid: false, message: "Codes can’t be checked right now. Please try again." });
    }
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { message: "Send a valid JSON request." });
    }
    const pkg = PACKAGE_PRICES[body?.package];
    const name = cleanText(body?.name, 120);
    const email = cleanText(body?.email, 160);
    if (!pkg || !name || !email) {
      return jsonResponse(400, { message: "Missing package, name, or email." });
    }

    try {
      let code = null;
      let partner = null;
      let percent = 0;
      let discount = null;
      const record = await findCode(normalizeCode(body.code));
      if (isCodeUsable(record)) {
        code = record.code;
        partner = record.partner;
        discount = discountOf(record);
        percent = discount.type === "percent" ? discount.percent : 0;
      }

      const createdAt = new Date().toISOString();
      const id = `${createdAt.replace(/[^0-9]/g, "")}-${randomUUID().slice(0, 8)}`;
      const inquiry = {
        id,
        createdAt,
        name,
        email,
        phone: cleanText(body.phone, 40),
        package: pkg.name,
        price: pkg.price,
        finalPrice: applyDiscount(pkg.price, discount),
        percent,
        discountLabel: discountLabel(discount),
        code,
        partner,
        heardFrom: cleanText(body.heardFrom, 80),
        date: cleanText(body.date, 80),
        time: cleanText(body.time, 80),
        packageId: body.package,
        dateISO: isISODate(body.dateISO) ? body.dateISO : null,
        startMin: isMinute(body.startMin) ? body.startMin : null,
        dayStatus: body.dayStatus === "secured" ? "secured" : body.dayStatus === "pending" ? "pending" : null,
        utm: body.utm && typeof body.utm === "object"
          ? {
              source: cleanText(body.utm.source, 60) || null,
              medium: cleanText(body.utm.medium, 60) || null,
              campaign: cleanText(body.utm.campaign, 80) || null,
              content: cleanText(body.utm.content, 80) || null
            }
          : null,
        notes: cleanText(body.notes, 600),
        ctx: process.env.CONTEXT || "unknown",
        booked: false
      };
      const store = await inquiriesStore();
      await store.setJSON(id, inquiry);

      // Automatic acknowledgement to the client (never says the booking is confirmed).
      let acknowledged = false;
      if ((await mailReady()) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        try {
          const settings = await readSettings();
          const mail = acknowledgementEmail(emailDetails(inquiry, settings));
          await Promise.race([
            sendMail({ to: email, ...mail }),
            new Promise((_, no) => setTimeout(() => no(new Error("Email timed out")), 9000))
          ]);
          logEmail(inquiry, { type: "acknowledgement", to: email, subject: mail.subject });
          acknowledged = true;
        } catch (error) {
          console.error("Acknowledgement email failed.", error);
          logEmail(inquiry, { type: "acknowledgement", to: email, subject: "We've received your Christmas session request", error: error.message || error });
        }
        await store.setJSON(id, inquiry);
      }
      return jsonResponse(200, { saved: true, percent, finalPrice: inquiry.finalPrice, acknowledged });
    } catch (error) {
      console.error("Unable to record inquiry.", error);
      return jsonResponse(502, { message: "Inquiry could not be recorded." });
    }
  }

  return jsonResponse(405, { message: "Use GET or POST." });
}
