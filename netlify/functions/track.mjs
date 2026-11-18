// Public: POST /api/track — privacy-friendly campaign analytics.
// No cookies, no IP addresses, no personal details. Each event is stored as its own record:
// { e: event, t: ISO time, s: random per-tab session id, p: page, pkg, utm: { source, medium, campaign, content }, ctx }
import { randomUUID } from "node:crypto";
import { cleanText, deployContext, eventsStore, jsonResponse, vancouverToday } from "../lib/referrals.mjs";

export const EVENTS = [
  "landing_view",
  "booking_view",
  "cta_click",
  "package_select",
  "date_select",
  "time_select",
  "form_start",
  "form_submit",
  "instagram_click"
];

export default async function handler(request) {
  if (request.method !== "POST") return jsonResponse(405, { message: "Use POST." });
  let body;
  try {
    body = JSON.parse((await request.text()).slice(0, 4000));
  } catch {
    return jsonResponse(400, { message: "Bad event." });
  }
  if (!EVENTS.includes(body?.e)) return jsonResponse(400, { message: "Unknown event." });

  const utm = body.utm && typeof body.utm === "object" ? body.utm : {};
  const event = {
    e: body.e,
    t: new Date().toISOString(),
    s: cleanText(body.s, 40),
    p: cleanText(body.p, 60),
    pkg: cleanText(body.pkg, 20) || null,
    utm: {
      source: cleanText(utm.source, 60) || null,
      medium: cleanText(utm.medium, 60) || null,
      campaign: cleanText(utm.campaign, 80) || null,
      content: cleanText(utm.content, 80) || null
    },
    // Netlify sets CONTEXT to production / deploy-preview / branch-deploy, so preview tests stay separate.
    ctx: deployContext(request)
  };
  try {
    const store = await eventsStore();
    const key = `${vancouverToday()}/${Date.now()}-${randomUUID().slice(0, 8)}`;
    await store.setJSON(key, event);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Unable to record event.", error);
    return jsonResponse(502, { message: "Not recorded." });
  }
}
