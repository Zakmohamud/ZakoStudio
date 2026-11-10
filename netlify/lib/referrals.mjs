// Shared helpers for referral codes and inquiry tracking (Netlify Blobs).
import { createHash, timingSafeEqual } from "node:crypto";

export const PACKAGE_PRICES = {
  quick: { name: "Quick session", price: 190, minutes: 15 },
  mini: { name: "Mini session", price: 300, minutes: 30 },
  extended: { name: "Extended session", price: 600, minutes: 60 }
};

// Minutes kept free after every session.
export const BREAK_MINUTES = 10;

const CODES_STORE = "referral-codes";
const INQUIRIES_STORE = "referral-inquiries";
const SCHEDULE_STORE = "booking-schedule";

export function packageIdFromName(name) {
  return Object.keys(PACKAGE_PRICES).find((id) => PACKAGE_PRICES[id].name === name) || null;
}

export function isISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isMinute(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1440;
}

// True when [start, end) clashes with an existing entry, counting the break after each session.
export function clashes(entries, start, end, ignoreId) {
  return entries.find(
    (e) => e.id !== ignoreId && start < e.end + BREAK_MINUTES && e.start < end + BREAK_MINUTES
  ) || null;
}

export function formatMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h >= 12 && h < 24 ? "p.m." : "a.m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

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
export const scheduleStore = () => openStore(SCHEDULE_STORE);

// Every schedule entry: { id, date, start, end, kind: "session" | "block", label }
export async function readSchedule() {
  const store = await scheduleStore();
  const keys = (await store.list()).blobs.map((b) => b.key);
  return (await Promise.all(keys.map((k) => store.get(k, { type: "json" })))).filter(Boolean);
}

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

// A code takes either a percentage or a fixed dollar amount off any package.
// Older codes only have `percent`.
export function discountOf(record) {
  if (record?.type === "amount") return { type: "amount", amount: record.amount };
  return { type: "percent", percent: record?.percent || 0 };
}

export function discountLabel(d) {
  if (!d) return "";
  if (d.type === "amount") return `$${Number.isInteger(d.amount) ? d.amount : d.amount.toFixed(2)} off`;
  return d.percent ? `${d.percent}% off` : "";
}

export function applyDiscount(price, d) {
  if (!d) return price;
  if (d.type === "amount") return Math.max(0, Math.round((price - d.amount) * 100) / 100);
  return discountedPrice(price, d.percent || 0);
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
