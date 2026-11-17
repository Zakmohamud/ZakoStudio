// Public: GET /api/schedule -> what the booking page needs to offer times (no client details).
// {
//   busy: { "2026-11-21": [[600, 630], ...] },          // booked sessions and blocks
//   days: [{ date, start, end, status }],               // session days ("secured" | "pending")
//   bufferMinutes, depositPercent, durations: { quick, mini, extended },
//   breakMinutes                                        // same as bufferMinutes (older pages)
// }
import { jsonResponse, readSchedule, readSettings, sessionDays, vancouverToday } from "../lib/referrals.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return jsonResponse(405, { message: "Use GET." });
  try {
    const today = vancouverToday();
    const [entries, settings] = await Promise.all([readSchedule(), readSettings()]);
    const busy = {};
    for (const entry of entries) {
      if (entry.date < today) continue;
      (busy[entry.date] ||= []).push([entry.start, entry.end]);
    }
    for (const list of Object.values(busy)) list.sort((a, b) => a[0] - b[0]);
    return jsonResponse(200, {
      busy,
      days: sessionDays(settings, today).map(({ date, start, end, status }) => ({ date, start, end, status })),
      bufferMinutes: settings.bufferMinutes,
      breakMinutes: settings.bufferMinutes,
      depositPercent: settings.depositPercent,
      durations: settings.durations
    });
  } catch (error) {
    console.error("Unable to read schedule.", error);
    return jsonResponse(502, { message: "Availability can’t be loaded right now." });
  }
}
