// Private: PUT /api/gallery-upload?g=<id>&p=<photo>&v=<variant>&n=<part>   (x-admin-password header)
// Body: up to 4 MB of the file. The bookings page splits large exports into parts.
import { jsonResponse, passwordMatches } from "../lib/referrals.mjs";
import { CHUNK_BYTES, VARIANTS, isId, putChunk, readGallery } from "../lib/gallery.mjs";

export default async function handler(request) {
  if (request.method !== "PUT" && request.method !== "POST") return jsonResponse(405, { message: "Use PUT." });
  if (!passwordMatches(request.headers.get("x-admin-password"))) {
    await new Promise((r) => setTimeout(r, 600));
    return jsonResponse(401, { message: "Wrong password." });
  }
  const url = new URL(request.url);
  const g = url.searchParams.get("g"), p = url.searchParams.get("p"), v = url.searchParams.get("v");
  const n = Number(url.searchParams.get("n"));
  if (!isId(p) || !VARIANTS.includes(v) || !Number.isInteger(n) || n < 0 || n > 200) return jsonResponse(400, { message: "Bad upload." });
  if (!(await readGallery(g))) return jsonResponse(404, { message: "Gallery not found." });
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > CHUNK_BYTES) return jsonResponse(413, { message: "Upload part too large." });
  await putChunk(g, p, v, n, bytes);
  return jsonResponse(200, { ok: true, bytes: bytes.byteLength });
}
