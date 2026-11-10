// Shared helpers for referral codes and inquiry tracking (Netlify Blobs).
import { createHash, timingSafeEqual } from "node:crypto";

export const PACKAGE_PRICES = {
  quick: { name: "Quick session", price: 175 },
  mini: { name: "Mini session", price: 300 },
  extended: { name: "Extended session", price: 600 }
};

const CODES_STORE = "referral-codes";
const INQUIRIES_STORE = "referral-inquiries";

let storeFactory = null;

// Tests can swap in an in-memory store.
export function setStoreFactory(factory) {
  storeFactory = factory;
}

async function openStore(name) {
  if (storeFactory) return storeFactory(name);
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name, consistency: "strong" });
}

export const codesStore = () => openStore(CODES_STORE);
export const inquiriesStore = () => openStore(INQUIRIES_STORE);

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

export function normalizeCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isValidCodeFormat(code) {
  return /^[A-Z0-9-]{3,24}$/.test(code);
}

export function vancouverToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

// A code works if it exists, is switched on, and its expiry date (inclusive) hasn't passed.
export function isCodeUsable(record) {
  if (!record || record.active === false) return false;
  if (record.expires && record.expires < vancouverToday()) return false;
  return true;
}

export async function findCode(code) {
  if (!isValidCodeFormat(code)) return null;
  const store = await codesStore();
  return store.get(code, { type: "json" });
}

export function discountedPrice(price, percent) {
  return Math.round(price * (100 - percent)) / 100;
}

export function cleanText(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function passwordMatches(given) {
  const expected = process.env.REFERRAL_ADMIN_PASSWORD;
  if (!expected || typeof given !== "string" || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
