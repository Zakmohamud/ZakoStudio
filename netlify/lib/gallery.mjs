// Client galleries: private, unguessable links to a family's finished photographs.
//
// Storage (Netlify Blobs for now; the file functions are the only place that touch files,
// so moving the photos to Cloudflare R2 later only changes this module):
//   client-galleries        g/<id>                       gallery record (JSON)
//   client-gallery-files    <id>/<photo>/<variant>/<n>   file bytes, split into ≤4 MB parts
// variants: thumb (≈600 px), web (≈2048 px) — made in the browser on upload — and full (the export as is).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { galleriesStore, galleryFilesStore } from "./referrals.mjs";

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

export async function deletePhotoFiles(g, photo) {
  const store = await galleryFilesStore();
  for (const v of VARIANTS) {
    const parts = photo.files?.[v]?.parts || 0;
    for (let n = 0; n < parts; n++) await store.delete(fileKey(g, photo.id, v, n));
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
