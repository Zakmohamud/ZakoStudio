// Public: GET /api/gallery?g=<id>[&t=<token>|&pin=<pin>]  -> the client's gallery
//         POST /api/gallery {g, t, photo, favourite}         -> heart / un-heart a photo
import { cleanText, jsonResponse } from "../lib/referrals.mjs";
import { isExpired, publicView, readGallery, tokenOk, writeGallery } from "../lib/gallery.mjs";

function gate(gallery, { t, pin }) {
  if (!gallery) return [404, { message: "This gallery link isn't valid. Please check the link or message Zako Studio." }];
  if (isExpired(gallery)) return [410, { state: "expired", clientName: gallery.clientName, message: "This gallery has closed. Message Zako Studio if you need your photographs again." }];
  if (!gallery.published) return [403, { state: "preparing", clientName: gallery.clientName, message: "Your photographs are being prepared. You'll receive a message as soon as they're ready." }];
  if (gallery.pin && !tokenOk(gallery, t) && cleanText(pin, 12) !== gallery.pin) {
    if (pin) return [401, { state: "pin", wrong: true, clientName: gallery.clientName }];
    return [401, { state: "pin", clientName: gallery.clientName }];
  }
  return null;
}

export default async function handler(request) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const gallery = await readGallery(url.searchParams.get("g"));
    const blocked = gate(gallery, { t: url.searchParams.get("t"), pin: url.searchParams.get("pin") });
    if (blocked) return jsonResponse(...blocked);
    return new Response(JSON.stringify(publicView(gallery)), {
      status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" }
    });
  }
  if (request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch {}
    const gallery = await readGallery(body.g);
    const blocked = gate(gallery, { t: body.t });
    if (blocked) return jsonResponse(...blocked);
    if (!tokenOk(gallery, body.t)) return jsonResponse(401, { message: "Not allowed." });
    const photo = (gallery.photos || []).find((p) => p.id === body.photo);
    if (!photo) return jsonResponse(404, { message: "Photo not found." });
    photo.favourite = Boolean(body.favourite);
    await writeGallery(gallery);
    return jsonResponse(200, { favourite: photo.favourite });
  }
  return jsonResponse(405, { message: "Use GET or POST." });
}
