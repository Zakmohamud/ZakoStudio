// Client galleries: private, unguessable links to a family's finished photographs.
//
// Storage: photo files go to Cloudflare R2 when the R2_* environment variables are set (the browser uploads straight
// to R2 with a short-lived signed link, and viewing redirects to a short-lived signed link). Without them, and for
// photos uploaded before the switch, files live in Netlify Blobs:
//   client-galleries        g/<id>                       gallery record (JSON)
//   client-gallery-files    <id>/<photo>/<variant>/<n>   file bytes, split into ≤4 MB parts
// variants: thumb (≈600 px), web (≈2048 px) — made in the browser on upload — and full (the export as is).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { galleriesStore, galleryFilesStore } from "./referrals.mjs";
import { r2Delete, r2Enabled, r2Url } from "./r2.mjs";

export { r2Enabled };

export const CHUNK_BYTES = 4 * 1024 * 1024;
export const VARIANTS = ["thumb", "web", "full"];
export const MAX_PHOTOS = 150;

const ID_RE = /^[A-Za-z0-9_-]{16,40}$/;
export const isId = (v) => typeof v === "string" && ID_RE.test(v);
export const newId = (bytes = 15) => randomBytes(bytes).toString("base64url");

function secret() {
  return process.env.GALLERY_SECRET || process.env.REFERRAL_ADMIN_PASSWORD || "zako-gallery";
}

// A short signature that proves a link came from us (and, with a PIN, that the PIN was given).
export function accessToken(gallery) {
  return createHmac("sha256", secret()).update(`${gallery.id}:${gallery.pin || ""}:${gallery.version || 1}`).digest("base64url").slice(0, 22);
}

export function tokenOk(gallery, token) {
  if (typeof token !== "string") return false;
  const a = Buffer.from(accessToken(gallery)); const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function readGallery(id) {
  if (!isId(id)) return null;
  const store = await galleriesStore();
  return (await store.get(`g/${id}`, { type: "json" })) || null;
}

export async function writeGallery(gallery) {
  gallery.updatedAt = new Date().toISOString();
  const store = await galleriesStore();
  await store.setJSON(`g/${gallery.id}`, gallery);
  return gallery;
}

export async function listGalleries() {
  const store = await galleriesStore();
  const { blobs } = await store.list({ prefix: "g/" });
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return all.filter(Boolean).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export const fileKey = (g, p, v, n) => `${g}/${p}/${v}/${n}`;

export async function putChunk(g, p, v, n, bytes) {
  const store = await galleryFilesStore();
  await store.set(fileKey(g, p, v, n), bytes);
}

export async function getChunk(g, p, v, n) {
  const store = await galleryFilesStore();
  return store.get(fileKey(g, p, v, n), { type: "arrayBuffer" });
}

// R2 object key for one variant of one photo.
export const r2Key = (g, p, v) => `galleries/${g}/${p}/${v}`;

// Signed upload links (15 minutes) for the three variants of a new photo.
export function uploadUrls(g, p) {
  return Object.fromEntries(VARIANTS.map((v) => [v, r2Url("PUT", r2Key(g, p, v), { expires: 900 })]));
}

// Checks an uploaded R2 object exists and returns its size (null if missing).
export async function r2Size(g, p, v) {
  const res = await fetch(r2Url("HEAD", r2Key(g, p, v), { expires: 120 }), { method: "HEAD" });
  return res.ok ? Number(res.headers.get("content-length")) : null;
}

// Signed viewing/download link (1 hour).
export function viewUrl(g, photo, v, { download = false } = {}) {
  const name = (photo.name || `photo-${photo.id}.jpg`).replace(/[^\w.\- ]+/g, "_");
  return r2Url("GET", r2Key(g, photo.id, v), { expires: 3600, downloadName: download ? name : undefined });
}

export async function deletePhotoFiles(g, photo) {
  let store = null;
  for (const v of VARIANTS) {
    const f = photo.files?.[v];
    if (!f) continue;
    if (f.store === "r2") { await r2Delete(r2Key(g, photo.id, v)); continue; }
    store ||= await galleryFilesStore();
    for (let n = 0; n < (f.parts || 0); n++) await store.delete(fileKey(g, photo.id, v, n));
  }
}

// What the client sees: no PIN, no admin notes.
export function publicView(gallery) {
  const t = accessToken(gallery);
  return {
    id: gallery.id,
    title: gallery.title,
    clientName: gallery.clientName,
    message: gallery.message || "",
    expiresAt: gallery.expiresAt || null,
    allowDownload: gallery.allowDownload !== false,
    token: t,
    photos: (gallery.photos || []).map((ph) => ({
      id: ph.id,
      name: ph.name,
      w: ph.w,
      h: ph.h,
      size: ph.files?.full?.size || 0,
      favourite: Boolean(ph.favourite)
    }))
  };
}

export function isExpired(gallery, now = new Date()) {
  return Boolean(gallery.expiresAt) && new Date(`${gallery.expiresAt}T23:59:59-08:00`) < now;
}
