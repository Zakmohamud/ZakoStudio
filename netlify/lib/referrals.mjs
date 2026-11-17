// Shared helpers for referral codes and inquiry tracking (Netlify Blobs).
import { createHash, timingSafeEqual } from "node:crypto";

// Christmas experiences. Ids stay quick/mini/extended so older links and records keep working.
export const PACKAGE_PRICES = {
  quick: { name: "The Keepsake", price: 190, minutes: 15 },
  mini: { name: "The Story", price: 300, minutes: 30 },
  extended: { name: "The Heirloom", price: 600, minutes: 60 }
};
const LEGACY_PACKAGE_NAMES = { "Quick session": "quick", "Mini session": "mini", "Extended session": "extended" };

// Default minutes kept free after every session (configurable in the admin page).
export const BREAK_MINUTES = 10;

const CODES_STORE = "referral-codes";
const INQUIRIES_STORE = "referral-inquiries";
const SCHEDULE_STORE = "booking-schedule";
const SETTINGS_STORE = "campaign-settings";
const EVENTS_STORE = "campaign-events";

export function packageIdFromName(name) {
  return Object.keys(PACKAGE_PRICES).find((id) => PACKAGE_PRICES[id].name === name)
    || LEGACY_PACKAGE_NAMES[name]
    || null;
}

// ---- Campaign settings (session days, buffer, deposit, durations) ----
export const DEFAULT_SETTINGS = {
  bufferMinutes: BREAK_MINUTES,
  depositPercent: 50,
  durations: { quick: 15, mini: 30, extended: 60 },
  defaultStart: 10 * 60,
  defaultEnd: 14 * 60,
  seasonEnd: "2026-12-20",
  // null = not set up yet: every weekend until seasonEnd is offered as "pending studio confirmation".
  days: null
};

export async function readSettings() {
  const store = await openStore(SETTINGS_STORE);
  const saved = (await store.get("christmas", { type: "json" })) || {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    durations: { ...DEFAULT_SETTINGS.durations, ...(saved.durations || {}) }
  };
}

export async function writeSettings(settings) {
  const store = await openStore(SETTINGS_STORE);
  await store.setJSON("christmas", settings);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Upcoming session days: { date, start, end, status: "secured" | "pending" }
export function sessionDays(settings, today = vancouverToday()) {
  if (Array.isArray(settings.days)) {
    return settings.days.filter((d) => d.date > today).sort((a, b) => a.date.localeCompare(b.date));
  }
  const days = [];
  for (let d = addDays(today, 1); d <= settings.seasonEnd; d = addDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) {
      days.push({ date: d, start: settings.defaultStart, end: settings.defaultEnd, status: "pending" });
    }
  }
  return days;
}

export const eventsStore = () => openStore(EVENTS_STORE);

export function isISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isMinute(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1440;
}

// True when [start, end) clashes with an existing entry, counting the break after each session.
export function clashes(entries, start, end, ignoreId, buffer = BREAK_MINUTES) {
  return entries.find(
    (e) => e.id !== ignoreId && start < e.end + buffer && e.start < end + buffer
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
