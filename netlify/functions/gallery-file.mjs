// Public: GET /api/gallery-file?g=<id>&p=<photo>&v=thumb|web|full&t=<token>[&dl=1]
// Streams the stored parts of one photo. Needs the gallery's secret token (only handed out by /api/gallery once the
// gallery is visible to the client, or to the bookings page), and the gallery must not have closed.
import { jsonResponse } from "../lib/referrals.mjs";
import { VARIANTS, getChunk, isExpired, isId, readGallery, tokenOk } from "../lib/gallery.mjs";

export default async function handler(request) {
  const url = new URL(request.url);
  const g = url.searchParams.get("g"), p = url.searchParams.get("p"), v = url.searchParams.get("v");
  if (!VARIANTS.includes(v) || !isId(p)) return jsonResponse(400, { message: "Bad request." });
  const gallery = await readGallery(g);
  if (!gallery || isExpired(gallery) || !tokenOk(gallery, url.searchParams.get("t"))) {
    return jsonResponse(404, { message: "Not found." });
  }
  const download = url.searchParams.get("dl") === "1";
  if ((v === "full" || download) && gallery.allowDownload === false) return jsonResponse(403, { message: "Downloads are turned off for this gallery." });
  const photo = (gallery.photos || []).find((x) => x.id === p);
  const file = photo?.files?.[v];
  if (!file) return jsonResponse(404, { message: "Not found." });

  let n = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (n >= file.parts) return controller.close();
      const part = await getChunk(gallery.id, photo.id, v, n++);
      if (!part) return controller.error(new Error("missing part"));
      controller.enqueue(new Uint8Array(part));
    }
  });
  const safeName = (photo.name || `photo-${photo.id}.jpg`).replace(/[^\w.\- ]+/g, "_");
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": file.type || "image/jpeg",
      "content-length": String(file.size),
      "cache-control": v === "full" ? "private, no-store" : "private, max-age=86400",
      "x-robots-tag": "noindex",
      ...(download ? { "content-disposition": `attachment; filename="${safeName}"` } : {})
    }
  });
}
