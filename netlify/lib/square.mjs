// Square payments: secure "Pay now" links for the reservation fee and the remaining balance, and the
// webhook check that tells the site a payment has gone through.
//
// Netlify environment variables (the owner pastes the two secrets in herself):
//   SQUARE_ACCESS_TOKEN            production access token of the Square app (secret)
//   SQUARE_WEBHOOK_SIGNATURE_KEY   optional; signature key of the webhook subscription. Without it, every
//                                  notification is double-checked by looking the payment up with Square.
//   SQUARE_LOCATION_ID             optional; the main active location is used when left out
//   SQUARE_ENVIRONMENT             optional; "sandbox" for Square's test environment
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const VERSION = "2024-10-17";
const env = (k) => String(process.env[k] || "").trim();

export const squareEnabled = () => Boolean(env("SQUARE_ACCESS_TOKEN"));
const base = () => (env("SQUARE_ENVIRONMENT") === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com");

async function call(method, path, body) {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env("SQUARE_ACCESS_TOKEN")}`,
      "square-version": VERSION,
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.errors?.map((e) => e.detail || e.code).join("; ") || `HTTP ${res.status}`;
    const err = new Error(`Square: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let cachedLocation = null;
export async function locationId() {
  if (env("SQUARE_LOCATION_ID")) return env("SQUARE_LOCATION_ID");
  if (cachedLocation) return cachedLocation;
  const { locations = [] } = await call("GET", "/v2/locations");
  const loc = locations.find((l) => l.status === "ACTIVE" && (l.capabilities || []).includes("CREDIT_CARD_PROCESSING")) ||
    locations.find((l) => l.status === "ACTIVE");
  if (!loc) throw new Error("Square: no active location on this account.");
  cachedLocation = loc.id;
  return loc.id;
}

// Status for the bookings page.
export async function squareStatus() {
  if (!squareEnabled()) return { ready: false };
  try {
    const { locations = [] } = await call("GET", "/v2/locations");
    const id = await locationId();
    const loc = locations.find((l) => l.id === id);
    return { ready: true, location: loc?.name || id, currency: loc?.currency || "CAD", webhook: true };
  } catch (error) {
    return { ready: false, error: error.message };
  }
}

// One payment link for one amount. Returns { id, url, orderId }.
export async function createPaymentLink({ name, amount, note, email, redirectUrl }) {
  const cents = Math.round(Number(amount) * 100);
  if (!(cents > 0)) throw new Error("Nothing to pay.");
  const body = {
    idempotency_key: randomUUID(),
    quick_pay: { name: String(name).slice(0, 255), price_money: { amount: cents, currency: "CAD" }, location_id: await locationId() },
    payment_note: String(note || "").slice(0, 500),
    checkout_options: { ask_for_shipping_address: false, ...(redirectUrl ? { redirect_url: redirectUrl } : {}) },
    ...(email ? { pre_populated_data: { buyer_email: email } } : {})
  };
  const { payment_link: link } = await call("POST", "/v2/online-checkout/payment-links", body);
  return { id: link.id, url: link.url, orderId: link.order_id };
}

// Looks a payment up directly with Square (the trusted source; webhook bodies are only a hint).
export async function getPayment(id) {
  const { payment } = await call("GET", `/v2/payments/${encodeURIComponent(id)}`);
  return payment;
}

export async function deletePaymentLink(id) {
  try { await call("DELETE", `/v2/online-checkout/payment-links/${encodeURIComponent(id)}`); } catch { /* already gone or paid */ }
}

// Square signs each webhook: base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)).
export function webhookSignatureOk(signature, notificationUrl, rawBody, key = env("SQUARE_WEBHOOK_SIGNATURE_KEY")) {
  if (!key || typeof signature !== "string") return false;
  const expected = Buffer.from(createHmac("sha256", key).update(notificationUrl + rawBody).digest("base64"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
