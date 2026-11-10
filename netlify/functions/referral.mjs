// Public endpoint used by the booking page.
//   GET  /api/referral?code=SARAH15   -> checks a code (never lists codes)
//   POST /api/referral                -> records an inquiry (with or without a code)
import { randomUUID } from "node:crypto";
import {
  PACKAGE_PRICES,
  cleanText,
  discountedPrice,
  findCode,
  inquiriesStore,
  isCodeUsable,
  isISODate,
  isMinute,
  jsonResponse,
  normalizeCode
} from "../lib/referrals.mjs";

export default async function handler(request) {
  if (request.method === "GET") {
    const code = normalizeCode(new URL(request.url).searchParams.get("code"));
    try {
      const record = await findCode(code);
      if (!isCodeUsable(record)) {
        return jsonResponse(200, { valid: false, message: "That code isn’t valid or has expired." });
      }
      return jsonResponse(200, { valid: true, code: record.code, percent: record.percent });
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
      const record = await findCode(normalizeCode(body.code));
      if (isCodeUsable(record)) {
        code = record.code;
        partner = record.partner;
        percent = record.percent;
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
        finalPrice: discountedPrice(pkg.price, percent),
        percent,
        code,
        partner,
        heardFrom: cleanText(body.heardFrom, 80),
        date: cleanText(body.date, 80),
        time: cleanText(body.time, 80),
        packageId: body.package,
        dateISO: isISODate(body.dateISO) ? body.dateISO : null,
        startMin: isMinute(body.startMin) ? body.startMin : null,
        booked: false
      };
      const store = await inquiriesStore();
      await store.setJSON(id, inquiry);
      return jsonResponse(200, { saved: true, percent, finalPrice: inquiry.finalPrice });
    } catch (error) {
      console.error("Unable to record inquiry.", error);
      return jsonResponse(502, { message: "Inquiry could not be recorded." });
    }
  }

  return jsonResponse(405, { message: "Use GET or POST." });
}
