// Minimal Cloudflare R2 (S3-compatible) client: presigned URLs (AWS Signature V4) and signed DELETE.
// Turned on by four Netlify environment variables: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
import { createHash, createHmac } from "node:crypto";

export const r2Enabled = () =>
  Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const hmac = (k, s) => createHmac("sha256", k).update(s).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (key) => key.split("/").map(enc).join("/");

// Generic SigV4 query-string presign. Exported (with explicit options) so it can be checked against AWS's published example.
export function presign({ method, host, path, accessKey, secretKey, region = "auto", service = "s3", expires = 900, now = new Date(), extraQuery = {} }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const q = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKey}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
    ...extraQuery
  };
  const query = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join("&");
  const canonical = [method, path, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const kSign = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), service), "aws4_request");
  const sig = createHmac("sha256", kSign).update(toSign).digest("hex");
  return `https://${host}${path}?${query}&X-Amz-Signature=${sig}`;
}

function target(key) {
  const host = `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return { host, path: `/${enc(process.env.R2_BUCKET)}/${encPath(key)}` };
}

export function r2Url(method, key, { expires = 900, downloadName } = {}) {
  const { host, path } = target(key);
  const extraQuery = downloadName ? { "response-content-disposition": `attachment; filename="${downloadName.replace(/"/g, "")}"` } : {};
  return presign({ method, host, path, accessKey: process.env.R2_ACCESS_KEY_ID, secretKey: process.env.R2_SECRET_ACCESS_KEY, expires, extraQuery });
}

export async function r2Delete(key) {
  const res = await fetch(r2Url("DELETE", key, { expires: 120 }), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status})`);
}
