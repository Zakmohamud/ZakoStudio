// Public: POST /api/square-webhook — Square tells the site when a payment changes.
// When a reservation-fee or balance payment completes, the booking is marked paid on its own.
import { inquiriesStore, jsonResponse, squareOrdersStore } from "../lib/referrals.mjs";
import { webhookSignatureOk } from "../lib/square.mjs";

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
  if (!urls.some((u) => webhookSignatureOk(signature, u, raw))) return jsonResponse(401, { message: "Bad signature." });

  let event;
  try { event = JSON.parse(raw); } catch { return jsonResponse(400, { message: "Bad body." }); }
  const payment = event?.data?.object?.payment;
  if (!payment || payment.status !== "COMPLETED" || !payment.order_id) return jsonResponse(200, { ignored: true });

  const orders = await squareOrdersStore();
  const ref = await orders.get(payment.order_id, { type: "json" });
  if (!ref) return jsonResponse(200, { ignored: true, reason: "unknown order" });

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
  return jsonResponse(200, { ok: true });
}
