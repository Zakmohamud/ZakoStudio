// Public: POST /api/square-webhook — Square tells the site when a payment changes.
// When a reservation-fee or balance payment completes, the booking is marked paid on its own.
import { inquiriesStore, jsonResponse, squareOrdersStore } from "../lib/referrals.mjs";
import { getPayment, squareEnabled, webhookSignatureOk } from "../lib/square.mjs";
import { emailDetails } from "../lib/emails.mjs";
import { mailReady, sendMail } from "../lib/mail.mjs";
import { readSettings } from "../lib/referrals.mjs";

// Lets the studio know a payment came in (sent to the studio's own Gmail).
async function tellStudio({ subject, lines, origin }) {
  try {
    const to = process.env.PAYMENT_ALERT_EMAIL || process.env.GMAIL_USER;
    if (!to || !(await mailReady())) return;
    const text = `${lines.join("\n")}\n\nOpen your bookings page: ${origin}/referral-admin.html`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#292622">${lines.map((l) => `<p style="margin:0 0 6px">${l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</p>`).join("")}<p style="margin:16px 0 0"><a href="${origin}/referral-admin.html">Open your bookings page</a></p></div>`;
    await sendMail({ to, subject, text, html });
  } catch (error) {
    console.error("Payment alert email failed.", error);
  }
}

export default async function handler(request) {
  if (request.method !== "POST") return jsonResponse(405, { message: "Use POST." });
  const raw = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");
  // Square signs against the URL registered for the subscription; accept the public /api address and the raw one.
  const urls = [
    process.env.SQUARE_WEBHOOK_URL,
    process.env.URL && `${process.env.URL}/api/square-webhook`,
    `${new URL(request.url).origin}/api/square-webhook`,
    request.url
  ].filter(Boolean);
  const signed = Boolean(process.env.SQUARE_WEBHOOK_SIGNATURE_KEY);
  if (signed && !urls.some((u) => webhookSignatureOk(signature, u, raw))) return jsonResponse(401, { message: "Bad signature." });
  if (!squareEnabled()) return jsonResponse(503, { message: "Square isn't set up." });

  let event;
  try { event = JSON.parse(raw); } catch { return jsonResponse(400, { message: "Bad body." }); }
  let payment = event?.data?.object?.payment;
  if (!payment?.id) return jsonResponse(200, { ignored: true });
  // Without a signature key, trust only what Square itself says about this payment.
  if (!signed) {
    try { payment = await getPayment(payment.id); } catch { return jsonResponse(200, { ignored: true, reason: "not a Square payment" }); }
  }
  if (!payment || payment.status !== "COMPLETED" || !payment.order_id) return jsonResponse(200, { ignored: true });

  const orders = await squareOrdersStore();
  const ref = await orders.get(payment.order_id, { type: "json" });
  if (!ref) return jsonResponse(200, { ignored: true, reason: "unknown order" });

  const origin = process.env.URL || new URL(request.url).origin;
  if (ref.kind === "test") {
    if (!ref.paidAt) await tellStudio({ subject: "💳 Test payment received: $1.00", lines: ["Your $1 website test payment went through, and your site picked it up.", "Remember to refund it in your Square Dashboard."], origin });
    await orders.setJSON(payment.order_id, { ...ref, paidAt: payment.updated_at || new Date().toISOString(), paidAmount: Number(payment.amount_money?.amount || 0) / 100 });
    return jsonResponse(200, { ok: true, test: true });
  }

  const inquiries = await inquiriesStore();
  const inquiry = await inquiries.get(ref.inquiryId, { type: "json" });
  if (!inquiry) return jsonResponse(200, { ignored: true, reason: "inquiry gone" });

  const paid = Math.round(Number(payment.amount_money?.amount || 0)) / 100;
  const at = payment.updated_at || new Date().toISOString();
  const log = inquiry.paymentLog || [];
  if (log.some((x) => x.paymentId === payment.id)) return jsonResponse(200, { duplicate: true });
  inquiry.paymentLog = [...log, { kind: ref.kind, amount: paid, at, via: "Square", paymentId: payment.id, receiptUrl: payment.receipt_url || null }].slice(-20);
  if (ref.kind === "fee") {
    Object.assign(inquiry, { depositReceived: true, depositAmount: paid, depositUpdatedAt: at, depositVia: "Square" });
  } else if (ref.kind === "balance") {
    Object.assign(inquiry, { balancePaid: true, balancePaidAt: at, balancePaidVia: "Square" });
  }
  await inquiries.setJSON(inquiry.id, inquiry);
  const d = emailDetails(inquiry, await readSettings());
  const money = `$${Number.isInteger(paid) ? paid : paid.toFixed(2)}`;
  await tellStudio({
    subject: ref.kind === "fee" ? `💳 Reservation fee paid: ${inquiry.name || "a client"}, ${money}` : `💳 Balance paid: ${inquiry.name || "a client"}, ${money}`,
    lines: [
      `${inquiry.name || "A client"} paid ${ref.kind === "fee" ? "the reservation fee" : "the remaining balance"} of ${money} by Square.`,
      `${d.experience} · ${d.date} · ${d.time}`,
      `Email: ${inquiry.email || ""}${inquiry.phone ? ` · Phone: ${inquiry.phone}` : ""}`,
      ref.kind === "fee" ? "It's marked “reservation fee received”. Next: send the booking confirmation." : "It's marked “balance paid”."
    ],
    origin
  });
  return jsonResponse(200, { ok: true });
}
