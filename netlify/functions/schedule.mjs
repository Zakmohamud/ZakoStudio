// Public: GET /api/schedule -> busy times for upcoming days (no client details).
// { busy: { "2026-11-14": [[480, 510], ...] }, breakMinutes: 10 }
import { BREAK_MINUTES, jsonResponse, readSchedule, vancouverToday } from "../lib/referrals.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return jsonResponse(405, { message: "Use GET." });
  try {
    const today = vancouverToday();
    const busy = {};
    for (const entry of await readSchedule()) {
      if (entry.date < today) continue;
      (busy[entry.date] ||= []).push([entry.start, entry.end]);
    }
    for (const list of Object.values(busy)) list.sort((a, b) => a[0] - b[0]);
    return jsonResponse(200, { busy, breakMinutes: BREAK_MINUTES });
  } catch (error) {
    console.error("Unable to read schedule.", error);
    return jsonResponse(502, { message: "Availability can’t be loaded right now." });
  }
}
