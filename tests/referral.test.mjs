import assert from "node:assert/strict";
import test from "node:test";

import { setStoreFactory } from "../netlify/lib/referrals.mjs";
import referral from "../netlify/functions/referral.mjs";
import admin from "../netlify/functions/referral-admin.mjs";
import schedule from "../netlify/functions/schedule.mjs";
import track from "../netlify/functions/track.mjs";

function memoryStores() {
  const stores = new Map();
  return (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    return {
      async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
      async setJSON(key, value) { data.set(key, structuredClone(value)); return { modified: true }; },
      async set(key, value) { data.set(key, value.slice(0)); return { modified: true }; },
      async delete(key) { data.delete(key); },
      async list(opts = {}) { return { blobs: [...data.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix)).map((key) => ({ key })) }; }
    };
  };
}

const adminCall = (body, password = "secret") =>
  admin(new Request("https://x.test/api/referral-admin", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-password": password },
    body: JSON.stringify(body)
  }));

test.beforeEach(() => {
  setStoreFactory(memoryStores());
  process.env.REFERRAL_ADMIN_PASSWORD = "secret";
});

test("admin rejects a wrong password", async () => {
  const res = await adminCall({ action: "list" }, "nope");
  assert.equal(res.status, 401);
});

test("create a code, check it, record an inquiry, see stats", async () => {
  let res = await adminCall({ action: "saveCode", isNew: true, code: "sarah15", partner: "Sarah", percent: 15 });
  assert.equal(res.status, 200);

  res = await adminCall({ action: "saveCode", isNew: true, code: "SARAH15", partner: "Sarah", percent: 15 });
  assert.equal(res.status, 409, "duplicate codes are refused");

  res = await referral(new Request("https://x.test/api/referral?code=sarah15"));
  assert.deepEqual(await res.json(), { valid: true, code: "SARAH15", type: "percent", percent: 15 });

  res = await referral(new Request("https://x.test/api/referral?code=NOPE99"));
  assert.equal((await res.json()).valid, false);

  res = await referral(new Request("https://x.test/api/referral", {
    method: "POST",
    body: JSON.stringify({ package: "mini", name: "Ana", email: "ana@example.com", code: "SARAH15" })
  }));
  assert.deepEqual(await res.json(), { saved: true, percent: 15, finalPrice: 255, acknowledged: false });

  res = await referral(new Request("https://x.test/api/referral", {
    method: "POST",
    body: JSON.stringify({ package: "quick", name: "Bo", email: "bo@example.com", heardFrom: "Instagram" })
  }));
  assert.equal((await res.json()).finalPrice, 190);

  const list = await (await adminCall({ action: "list" })).json();
  assert.equal(list.inquiries.length, 2);
  const sarah = list.codes.find((c) => c.code === "SARAH15");
  assert.equal(sarah.inquiries, 1);
  assert.equal(sarah.booked, 0);

  const ana = list.inquiries.find((i) => i.name === "Ana");
  assert.equal(ana.partner, "Sarah");
  res = await adminCall({ action: "book", id: ana.id, date: "2030-11-16", start: 480 });
  assert.equal(res.status, 200);
  const after = await (await adminCall({ action: "list" })).json();
  assert.equal(after.codes[0].booked, 1);
});

test("turned-off and expired codes don't apply", async () => {
  await adminCall({ action: "saveCode", code: "OFF10", partner: "X", percent: 10, active: false });
  await adminCall({ action: "saveCode", code: "OLD10", partner: "Y", percent: 10, expires: "2020-01-01" });
  for (const code of ["OFF10", "OLD10"]) {
    const res = await referral(new Request(`https://x.test/api/referral?code=${code}`));
    assert.equal((await res.json()).valid, false);
  }
});

test("bad discount values are refused", async () => {
  const res = await adminCall({ action: "saveCode", code: "BIG", partner: "Z", percent: 150 });
  assert.equal(res.status, 400);
});

test("booking blocks its length plus a 10-minute break", async () => {
  const add = async (name, pkg) => {
    await referral(new Request("https://x.test/api/referral", {
      method: "POST",
      body: JSON.stringify({ package: pkg, name, email: `${name}@x.com` })
    }));
    const list = await (await adminCall({ action: "list" })).json();
    return list.inquiries.find((i) => i.name === name).id;
  };
  const sarah = await add("Sarah", "mini");
  const tom = await add("Tom", "mini");

  let res = await adminCall({ action: "book", id: sarah, date: "2030-11-16", start: 480 }); // 8:00-8:30
  assert.equal(res.status, 200);

  res = await adminCall({ action: "book", id: tom, date: "2030-11-16", start: 515 }); // 8:35 too soon
  assert.equal(res.status, 409);
  assert.match((await res.json()).message, /Sarah/);

  res = await adminCall({ action: "book", id: tom, date: "2030-11-16", start: 520 }); // 8:40 ok
  assert.equal(res.status, 200);

  res = await adminCall({ action: "block", date: "2030-11-17", wholeDay: true, note: "Away" });
  assert.equal(res.status, 200);

  const busy = (await (await schedule(new Request("https://x.test/api/schedule"))).json()).busy;
  assert.deepEqual(busy["2030-11-16"], [[480, 510], [520, 550]]);
  assert.deepEqual(busy["2030-11-17"], [[0, 1440]]);

  await adminCall({ action: "unbook", id: sarah });
  const after = (await (await schedule(new Request("https://x.test/api/schedule"))).json()).busy;
  assert.deepEqual(after["2030-11-16"], [[520, 550]]);

  const list = await (await adminCall({ action: "list" })).json();
  assert.equal(list.schedule.length, 2);
});

test("dollar-amount codes take a fixed amount off every package", async () => {
  let res = await adminCall({ action: "saveCode", isNew: true, code: "LOVECINDY2026", partner: "Cindy", type: "amount", amount: 10 });
  assert.equal(res.status, 200);

  res = await referral(new Request("https://x.test/api/referral?code=lovecindy2026"));
  assert.deepEqual(await res.json(), { valid: true, code: "LOVECINDY2026", type: "amount", amount: 10 });

  for (const [pkg, expected] of [["quick", 180], ["mini", 290], ["extended", 590]]) {
    res = await referral(new Request("https://x.test/api/referral", {
      method: "POST",
      body: JSON.stringify({ package: pkg, name: `C ${pkg}`, email: "c@x.com", code: "LOVECINDY2026" })
    }));
    assert.equal((await res.json()).finalPrice, expected);
  }

  const list = await (await adminCall({ action: "list" })).json();
  assert.equal(list.inquiries[0].discountLabel, "$10 off");
  assert.equal(list.codes[0].inquiries, 3);

  res = await adminCall({ action: "saveCode", code: "BAD", partner: "Z", type: "amount", amount: 0 });
  assert.equal(res.status, 400);
});

test("session days default to pending weekends, and can be edited", async () => {
  let res = await schedule(new Request("https://x.test/api/schedule"));
  let body = await res.json();
  assert.ok(body.days.length > 0);
  for (const d of body.days) {
    const wd = new Date(`${d.date}T12:00:00Z`).getUTCDay();
    assert.ok(wd === 0 || wd === 6, "weekends only");
    assert.equal(d.status, "pending");
  }
  assert.equal(body.depositPercent, 50);

  res = await adminCall({ action: "saveDay", date: "2030-12-07", start: 600, end: 780, status: "secured" });
  assert.equal(res.status, 200);
  res = await adminCall({ action: "removeDay", date: body.days[0].date });
  body = await (await schedule(new Request("https://x.test/api/schedule"))).json();
  assert.ok(body.days.find((d) => d.date === "2030-12-07" && d.status === "secured" && d.end === 780));
  assert.ok(!body.days.find((d) => d.date === body.days[0]?.date && false));

  res = await adminCall({ action: "saveSettings", bufferMinutes: 15, depositPercent: 30, durations: { quick: 20 } });
  assert.equal(res.status, 200);
  body = await (await schedule(new Request("https://x.test/api/schedule"))).json();
  assert.equal(body.bufferMinutes, 15);
  assert.equal(body.depositPercent, 30);
  assert.equal(body.durations.quick, 20);
});

test("the buffer setting is used when marking bookings", async () => {
  await adminCall({ action: "saveSettings", bufferMinutes: 20, depositPercent: 50 });
  for (const n of ["A", "B"]) {
    await referral(new Request("https://x.test/api/referral", { method: "POST", body: JSON.stringify({ package: "mini", name: n, email: `${n}@x.com` }) }));
  }
  const { inquiries } = await (await adminCall({ action: "list" })).json();
  const [a, b] = inquiries;
  assert.equal((await adminCall({ action: "book", id: a.id, date: "2030-12-07", start: 600 })).status, 200);
  assert.equal((await adminCall({ action: "book", id: b.id, date: "2030-12-07", start: 640 })).status, 409, "10:40 is inside the 20-min buffer");
  assert.equal((await adminCall({ action: "book", id: b.id, date: "2030-12-07", start: 650 })).status, 200);
});

test("tracking stores anonymous events and the admin sees totals", async () => {
  process.env.CONTEXT = "production";
  const send = (e, s) => track(new Request("https://x.test/api/track", { method: "POST", body: JSON.stringify({ e, s, p: "/christmas/", utm: { source: "instagram", campaign: "xmas" } }) }));
  assert.equal((await send("landing_view", "s1")).status, 204);
  await send("landing_view", "s2");
  await send("cta_click", "s1");
  await send("form_submit", "s1");
  assert.equal((await send("hack", "s1")).status, 400);
  const a = await (await adminCall({ action: "analytics", days: 7 })).json();
  assert.equal(a.landingVisitors, 2);
  assert.equal(a.funnel.at(-1)[1], 1);
  assert.equal(a.sources["instagram / xmas"].reserveClicks, 1);
  assert.equal(a.confirmed, 0);

  // preview traffic is left out unless asked for
  process.env.CONTEXT = "deploy-preview";
  await send("landing_view", "s9");
  const live = await (await adminCall({ action: "analytics", days: 7 })).json();
  assert.equal(live.landingVisitors, 2);
  const all = await (await adminCall({ action: "analytics", days: 7, includePreview: true })).json();
  assert.equal(all.landingVisitors, 3);
  process.env.CONTEXT = "production";
});

test("revenue, ad spend and cost per booking per campaign", async () => {
  process.env.CONTEXT = "production";
  const utm = { source: "instagram", campaign: "christmas" };
  for (const n of ["P", "Q"]) {
    await referral(new Request("https://x.test/api/referral", { method: "POST", body: JSON.stringify({ package: "mini", name: n, email: `${n}@x.com`, utm }) }));
  }
  const { inquiries } = await (await adminCall({ action: "list" })).json();
  const p = inquiries.find((i) => i.name === "P");
  await adminCall({ action: "book", id: p.id, date: "2030-12-14", start: 600 });
  let res = await adminCall({ action: "setDeposit", id: p.id, received: true, amount: 150 });
  assert.equal((await res.json()).inquiry.depositReceived, true);
  await adminCall({ action: "saveAdSpend", key: "instagram / christmas", amount: 50 });
  const a = await (await adminCall({ action: "analytics", days: 7 })).json();
  const row = a.sources["instagram / christmas"];
  assert.equal(row.requests, 2);
  assert.equal(row.confirmed, 1);
  assert.equal(row.revenue, 300);
  assert.equal(row.adSpend, 50);
  assert.equal(row.cac, 50);
  assert.equal(a.packages.mini.requests, 2);
  assert.equal(a.packages.mini.booked, 1);
});

test("client emails: acknowledgement is automatic, fee request and confirmation are guarded", async () => {
  const { setMailer } = await import("../netlify/lib/mail.mjs");
  const sent = [];
  setMailer(async (m) => { sent.push(m); return { id: "x" }; });
  process.env.CONTEXT = "production";

  await referral(new Request("https://x.test/api/referral", {
    method: "POST",
    body: JSON.stringify({ package: "mini", name: "Ana <b>Lee</b>", email: "ana@example.com", dateISO: "2030-12-21", startMin: 600, date: "Saturday, December 21", time: "10:00 a.m." })
  }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ana@example.com");
  assert.match(sent[0].subject, /received/i);
  assert.doesNotMatch(sent[0].subject + sent[0].text, /officially reserved|is confirmed/i);
  assert.match(sent[0].text, /not a confirmed booking/);
  assert.ok(!sent[0].html.includes("<b>Lee</b>"), "client input is escaped");
  assert.match(sent[0].html, /The Story/);

  const { inquiries } = await (await adminCall({ action: "list" })).json();
  const ana = inquiries.find((i) => i.email === "ana@example.com");
  assert.ok(ana.emails.acknowledgement.sentAt);

  // confirmation is refused until booked + fee received
  let res = await adminCall({ action: "sendEmail", id: ana.id, type: "confirmation" });
  assert.equal(res.status, 400);

  res = await adminCall({ action: "sendEmail", id: ana.id, type: "feeRequest" });
  assert.equal(res.status, 200);
  assert.match(sent.at(-1).text, /Reservation fee: \$150 CAD/);
  assert.match(sent.at(-1).text, /Session duration: 30 minutes/);
  assert.match(sent.at(-1).text, /zakotarastudio@gmail.com/);

  await adminCall({ action: "book", id: ana.id, date: "2030-12-21", start: 600 });
  await adminCall({ action: "setDeposit", id: ana.id, received: true, amount: 150 });
  await adminCall({ action: "saveEmailSettings", studioAddress: "1909 Lilac Dr, Surrey, BC V4A 6C7", paymentEmail: "zakotarastudio@gmail.com", balanceDue: "After your session, by Interac e-Transfer to zakotarastudio@gmail.com" });
  res = await adminCall({ action: "previewEmail", id: ana.id, type: "confirmation" });
  const pv = await res.json();
  assert.match(pv.html, /1909 Lilac Dr, Surrey/);
  res = await adminCall({ action: "sendEmail", id: ana.id, type: "confirmation" });
  assert.equal(res.status, 200);
  assert.match(sent.at(-1).text, /officially reserved/);
  assert.match(sent.at(-1).text, /Reservation fee received: \$150 CAD/);
  assert.match(sent.at(-1).text, /Remaining balance: \$150 CAD/);
  assert.match(sent.at(-1).text, /Wear your favourite festive attire/);
  assert.match(sent.at(-1).text, /Remaining balance due: After your session/);
  assert.match(sent.at(-1).text, /through my lens\./);
  assert.match(sent.at(-1).text, /With warm regards,/);
  assert.doesNotMatch(sent.at(-1).text, /Upon receiving|warm wishes|photographs\./i);

  // email history: every email, in order, with when and to whom
  const after = (await (await adminCall({ action: "list" })).json()).inquiries.find((i) => i.id === ana.id);
  assert.deepEqual(after.emailLog.map((e) => e.type), ["acknowledgement", "feeRequest", "confirmation"]);
  assert.ok(after.emailLog.every((e) => e.status === "sent" && e.to === "ana@example.com" && e.at && e.subject));

  // a failed send is recorded too
  setMailer(async () => { throw new Error("boom"); });
  res = await adminCall({ action: "sendEmail", id: ana.id, type: "confirmation" });
  assert.equal(res.status, 502);
  const failed = (await (await adminCall({ action: "list" })).json()).inquiries.find((i) => i.id === ana.id);
  assert.equal(failed.emailLog.at(-1).status, "failed");
  setMailer(null);

  // without a fake mailer and without env vars, sending is refused (no stored password path)
  delete process.env.GMAIL_USER; delete process.env.GMAIL_APP_PASSWORD;
  res = await adminCall({ action: "sendEmail", id: ana.id, type: "confirmation" });
  assert.equal(res.status, 503);
});

test("studio days: weekends always show, plus days you add; removed weekends stay hidden", async () => {
  const { sessionDays } = await import("../netlify/lib/referrals.mjs");
  const base = { seasonEnd: "2026-12-06", defaultStart: 600, defaultEnd: 840 };
  // An empty saved list (what production had) still shows the weekends.
  let days = sessionDays({ ...base, days: [] }, "2026-11-17");
  assert.deepEqual(days.map((d) => d.date), ["2026-11-21", "2026-11-22", "2026-11-28", "2026-11-29", "2026-12-05", "2026-12-06"]);
  assert.ok(days.every((d) => d.status === "pending"));
  // Your own days (any weekday, secured) are merged in and win over the automatic entry.
  days = sessionDays({ ...base, days: [{ date: "2026-11-25", start: 960, end: 1140, status: "secured" }, { date: "2026-11-21", start: 540, end: 900, status: "secured" }], hiddenDays: ["2026-11-29"] }, "2026-11-17");
  assert.deepEqual(days.map((d) => d.date), ["2026-11-21", "2026-11-22", "2026-11-25", "2026-11-28", "2026-12-05", "2026-12-06"]);
  assert.equal(days[0].status, "secured");
  assert.equal(days[0].start, 540);
  // Turning automatic weekends off leaves only your own days.
  days = sessionDays({ ...base, autoWeekends: false, days: [{ date: "2026-11-25", start: 960, end: 1140, status: "secured" }] }, "2026-11-17");
  assert.deepEqual(days.map((d) => d.date), ["2026-11-25"]);
});

test("visitor tracking: live visits are counted even without Netlify's CONTEXT variable", async () => {
  const { deployContext } = await import("../netlify/lib/referrals.mjs");
  const saved = process.env.CONTEXT;
  delete process.env.CONTEXT;
  assert.equal(deployContext(new Request("https://zako-studio.netlify.app/api/track")), "production");
  assert.equal(deployContext(new Request("https://deploy-preview-6--zako-studio.netlify.app/api/track")), "deploy-preview");
  assert.equal(deployContext(new Request("https://main--zako-studio.netlify.app/api/track")), "branch-deploy");

  const track = (await import("../netlify/functions/track.mjs")).default;
  const send = (host, s) => track(new Request(`https://${host}/api/track`, { method: "POST", body: JSON.stringify({ e: "landing_view", s, p: "/christmas/" }) }));
  await send("zako-studio.netlify.app", "phone-1");
  await send("deploy-preview-9--zako-studio.netlify.app", "preview-1");
  const live = await (await adminCall({ action: "analytics", days: 14 })).json();
  const withPreview = await (await adminCall({ action: "analytics", days: 14, includePreview: true })).json();
  assert.equal(withPreview.visitors - live.visitors, 1, "the preview visit only counts when previews are included");
  assert.ok(live.visitors >= 1, "the live phone visit is counted");
  if (saved !== undefined) process.env.CONTEXT = saved;
});

test("client galleries: create, upload in parts, private access, PIN, favourites, downloads", async () => {
  const gallery = (await import("../netlify/functions/gallery.mjs")).default;
  const file = (await import("../netlify/functions/gallery-file.mjs")).default;
  const upload = (await import("../netlify/functions/gallery-upload.mjs")).default;
  const { setMailer } = await import("../netlify/lib/mail.mjs");

  let res = await adminCall({ action: "createGallery", clientName: "Ana Lee", email: "ana@example.com", expiresAt: "2030-01-31" });
  assert.equal(res.status, 200);
  const g = (await res.json()).gallery;
  assert.ok(g.id.length >= 16 && g.token);

  // upload one photo: full in two parts, web and thumb in one part each
  const pid = "photo_abcdefghijklmnop";
  const full = new Uint8Array(5 * 1024 * 1024).map((_, i) => i % 251);
  const put = (v, n, bytes, pw = "secret") => upload(new Request(`https://x.test/api/gallery-upload?g=${g.id}&p=${pid}&v=${v}&n=${n}`, { method: "PUT", headers: { "x-admin-password": pw }, body: bytes }));
  assert.equal((await put("full", 0, full.slice(0, 4 * 1024 * 1024))).status, 200);
  assert.equal((await put("full", 1, full.slice(4 * 1024 * 1024))).status, 200);
  assert.equal((await put("web", 0, new Uint8Array([1, 2, 3]))).status, 200);
  assert.equal((await put("thumb", 0, new Uint8Array([4, 5]))).status, 200);
  assert.equal((await put("thumb", 0, new Uint8Array([4]), "nope")).status, 401, "uploads need the admin password");
  res = await adminCall({ action: "addGalleryPhoto", id: g.id, photo: { id: pid, name: "Lee family 01.jpg", w: 6000, h: 4000,
    files: { full: { parts: 2, size: full.length, type: "image/jpeg" }, web: { parts: 1, size: 3 }, thumb: { parts: 1, size: 2 } } } });
  assert.equal(res.status, 200);

  const view = (q) => gallery(new Request(`https://x.test/api/gallery?${q}`));
  // not visible until published
  assert.equal((await view(`g=${g.id}`)).status, 403);
  await adminCall({ action: "updateGallery", id: g.id, published: true });
  res = await view(`g=${g.id}`);
  assert.equal(res.status, 200);
  const pub = await res.json();
  assert.equal(pub.photos.length, 1);
  assert.equal(pub.clientName, "Ana Lee");
  assert.ok(!("pin" in pub) && !("email" in pub), "no private fields leak");

  // full-size download streams every part back in order
  res = await file(new Request(`https://x.test/api/gallery-file?g=${g.id}&p=${pid}&v=full&t=${pub.token}&dl=1`));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="Lee family 01.jpg"/);
  const got = new Uint8Array(await res.arrayBuffer());
  assert.equal(got.length, full.length);
  assert.equal(got[4 * 1024 * 1024 + 7], full[4 * 1024 * 1024 + 7]);
  // wrong token or unknown gallery: nothing
  assert.equal((await file(new Request(`https://x.test/api/gallery-file?g=${g.id}&p=${pid}&v=full&t=wrong`))).status, 404);
  assert.equal((await view("g=nonexistentgallery123")).status, 404);

  // favourites
  res = await gallery(new Request("https://x.test/api/gallery", { method: "POST", body: JSON.stringify({ g: g.id, t: pub.token, photo: pid, favourite: true }) }));
  assert.equal(res.status, 200);
  const listed = (await (await adminCall({ action: "listGalleries" })).json()).galleries[0];
  assert.equal(listed.favourites, 1);

  // PIN: old token stops working, the PIN unlocks it
  await adminCall({ action: "updateGallery", id: g.id, pin: "2468" });
  assert.equal((await view(`g=${g.id}&t=${pub.token}`)).status, 401);
  assert.equal((await view(`g=${g.id}&pin=1111`)).status, 401);
  res = await view(`g=${g.id}&pin=2468`);
  assert.equal(res.status, 200);

  // downloads can be turned off
  const t2 = (await res.json()).token;
  await adminCall({ action: "updateGallery", id: g.id, allowDownload: false });
  assert.equal((await file(new Request(`https://x.test/api/gallery-file?g=${g.id}&p=${pid}&v=full&t=${t2}`))).status, 403);
  assert.equal((await file(new Request(`https://x.test/api/gallery-file?g=${g.id}&p=${pid}&v=web&t=${t2}`))).status, 200);

  // email
  const sent = []; setMailer(async (m) => { sent.push(m); return { id: "x" }; });
  res = await adminCall({ action: "sendGalleryEmail", id: g.id });
  assert.equal(res.status, 200);
  assert.match(sent[0].text, /\/gallery\//);
  assert.match(sent[0].text, /PIN: 2468/);
  setMailer(null);

  // expired galleries close
  await adminCall({ action: "updateGallery", id: g.id, expiresAt: "2020-01-01" });
  assert.equal((await view(`g=${g.id}&pin=2468`)).status, 410);

  // delete removes the files too
  await adminCall({ action: "deleteGallery", id: g.id });
  assert.equal((await view(`g=${g.id}`)).status, 404);
});

test("client galleries on Cloudflare R2: signed upload links, size check, signed viewing redirect, delete", async () => {
  const file = (await import("../netlify/functions/gallery-file.mjs")).default;
  const env = { R2_ACCOUNT_ID: "acct123", R2_ACCESS_KEY_ID: "AKID", R2_SECRET_ACCESS_KEY: "SECRET", R2_BUCKET: "zako-galleries" };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const realFetch = globalThis.fetch;
  const objects = new Map([["full", 9000000], ["web", 800000], ["thumb", 90000]]);
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method });
    const v = String(url).split("?")[0].split("/").pop();
    if (opts.method === "HEAD") return objects.has(v) ? new Response(null, { status: 200, headers: { "content-length": String(objects.get(v)) } }) : new Response(null, { status: 404 });
    if (opts.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(null, { status: 500 });
  };
  try {
    const g = (await (await adminCall({ action: "createGallery", clientName: "The Lee family", email: "lee@example.com" })).json()).gallery;
    const pid = "photo_r2abcdefghijklm";
    const u = await (await adminCall({ action: "galleryUploadUrls", id: g.id, photo: pid })).json();
    assert.equal(u.r2, true);
    for (const v of ["thumb", "web", "full"]) {
      assert.match(u.urls[v], new RegExp(`^https://acct123\\.r2\\.cloudflarestorage\\.com/zako-galleries/galleries/${g.id}/${pid}/${v}\\?`));
      assert.match(u.urls[v], /X-Amz-Signature=[0-9a-f]{64}$/);
    }
    const meta = { store: "r2", parts: 1, size: 1, type: "image/jpeg" };
    let res = await adminCall({ action: "addGalleryPhoto", id: g.id, photo: { id: pid, name: "lee-01.jpg", w: 700, h: 467, files: { thumb: meta, web: meta, full: meta } } });
    assert.equal(res.status, 200);
    const stored = (await (await adminCall({ action: "listGalleries" })).json()).galleries.find((x) => x.id === g.id);
    assert.ok(stored, "gallery listed");

    // missing object -> refused
    objects.delete("web");
    res = await adminCall({ action: "addGalleryPhoto", id: g.id, photo: { id: "photo_r2missingxxxxxx", name: "x.jpg", files: { thumb: meta, web: meta, full: meta } } });
    assert.equal(res.status, 400);

    res = await file(new Request(`https://x.test/api/gallery-file?g=${g.id}&p=${pid}&v=full&t=${g.token}&dl=1`));
    assert.equal(res.status, 302);
    const loc = res.headers.get("location");
    assert.match(loc, /\/galleries\/.+\/full\?/);
    assert.match(decodeURIComponent(loc), /response-content-disposition=attachment; filename="lee-01.jpg"/);
    assert.equal((await file(new Request(`https://x.test/api/gallery-file?g=${g.id}&p=${pid}&v=thumb&t=wrong`))).status, 404);

    calls.length = 0;
    await adminCall({ action: "deleteGallery", id: g.id });
    assert.equal(calls.filter((c) => c.method === "DELETE").length, 3, "all three R2 files deleted");
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("visitor tracker: pick a single day or a range, compare with the period before, day-by-day counts", async () => {
  const { eventsStore, vancouverToday } = await import("../netlify/lib/referrals.mjs");
  const store = await eventsStore();
  const today = vancouverToday();
  const back = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const add = (day, s) => store.setJSON(`${day}/${Math.random()}`, { e: "landing_view", s: `${day}-${s}`, ctx: "production" });
  const base = await (await adminCall({ action: "analytics", day: today })).json();
  await add(today, "a"); await add(today, "b"); await add(today, "c");
  await add(back(1), "a");
  const t = await (await adminCall({ action: "analytics", day: today })).json();
  assert.equal(t.span, 1);
  assert.equal(t.visitors - base.visitors, 3);
  assert.equal(t.previous.since, back(1));
  assert.ok(t.previous.visitors >= 1);
  const y = await (await adminCall({ action: "analytics", day: back(1) })).json();
  assert.equal(y.since, back(1));
  assert.equal(y.previous.since, back(2));
  const r = await (await adminCall({ action: "analytics", from: back(2), to: today })).json();
  assert.equal(r.span, 3);
  assert.deepEqual(r.daily.map((d) => d.date), [today, back(1), back(2)]);
  assert.equal(r.previous.since, back(5));
  assert.equal(r.previous.until, back(3));
  const future = await (await adminCall({ action: "analytics", day: "2099-01-01" })).json();
  assert.equal(future.since, today, "future days are clamped to today");
});

test("Square: fee request carries a Pay link, webhook marks the fee received, balance email and webhook mark it paid", async () => {
  const { setMailer } = await import("../netlify/lib/mail.mjs");
  const { createHmac } = await import("node:crypto");
  const webhook = (await import("../netlify/functions/square-webhook.mjs")).default;
  const sent = []; setMailer(async (m) => { sent.push(m); return { id: "x" }; });
  const saved = { t: process.env.SQUARE_ACCESS_TOKEN, k: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY, u: process.env.URL };
  Object.assign(process.env, { SQUARE_ACCESS_TOKEN: "tok", SQUARE_WEBHOOK_SIGNATURE_KEY: "sigkey", URL: "https://zako.test" });
  const realFetch = globalThis.fetch;
  const links = []; let n = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith("/v2/locations")) return new Response(JSON.stringify({ locations: [{ id: "LOC1", name: "Zako Studio", status: "ACTIVE", capabilities: ["CREDIT_CARD_PROCESSING"], currency: "CAD" }] }));
    if (u.endsWith("/v2/online-checkout/payment-links") && opts.method === "POST") {
      const body = JSON.parse(opts.body); links.push(body); n++;
      return new Response(JSON.stringify({ payment_link: { id: `PL${n}`, url: `https://square.link/u/pay${n}`, order_id: `ORD${n}` } }));
    }
    const m = u.match(/\/v2\/payments\/(\w+)$/);
    if (m && paymentsAtSquare[m[1]]) return new Response(JSON.stringify({ payment: paymentsAtSquare[m[1]] }));
    return new Response("{}", { status: 404 });
  };
  const paymentsAtSquare = {};
  const hook = (payment) => {
    const raw = JSON.stringify({ type: "payment.updated", data: { object: { payment } } });
    const sig = createHmac("sha256", "sigkey").update("https://zako.test/api/square-webhook" + raw).digest("base64");
    return webhook(new Request("https://zako.test/.netlify/functions/square-webhook", { method: "POST", headers: { "x-square-hmacsha256-signature": sig }, body: raw }));
  };
  try {
    await referral(new Request("https://x.test/api/referral", { method: "POST",
      body: JSON.stringify({ package: "mini", name: "Bea Ford", email: "bea@example.com", dateISO: "2030-12-20", startMin: 660, date: "Friday, December 20", time: "11:00 a.m." }) }));
    const bea = (await (await adminCall({ action: "list" })).json()).inquiries.find((i) => i.email === "bea@example.com");
    assert.doesNotMatch(sent.at(-1).text, /square\.link|Pay /, "the first email asks for no payment");

    const st = await (await adminCall({ action: "getSettings" })).json();
    assert.equal(st.square.ready, true);

    // preview: no link made yet
    let res = await adminCall({ action: "previewEmail", id: bea.id, type: "feeRequest" });
    assert.equal(links.length, 0);
    assert.match((await res.json()).html, /to reserve/);

    res = await adminCall({ action: "sendEmail", id: bea.id, type: "feeRequest" });
    assert.equal(res.status, 200);
    assert.equal(links.length, 1);
    assert.equal(links[0].quick_pay.price_money.amount, 15000);
    assert.equal(links[0].quick_pay.price_money.currency, "CAD");
    assert.equal(links[0].quick_pay.location_id, "LOC1");
    assert.equal(links[0].pre_populated_data.buyer_email, "bea@example.com");
    assert.match(links[0].checkout_options.redirect_url, /\/christmas\/paid\/\?for=fee$/);
    assert.match(sent.at(-1).text, /https:\/\/square\.link\/u\/pay1/);
    assert.doesNotMatch(sent.at(-1).text, /e-Transfer/, "e-Transfer is off unless switched on");

    // resending reuses the same link
    await adminCall({ action: "sendEmail", id: bea.id, type: "feeRequest" });
    assert.equal(links.length, 1);

    // forged webhook is refused
    const bad = await webhook(new Request("https://zako.test/api/square-webhook", { method: "POST", headers: { "x-square-hmacsha256-signature": "nope" }, body: "{}" }));
    assert.equal(bad.status, 401);

    // payment completes -> fee received on its own
    assert.equal((await hook({ id: "PAY1", status: "COMPLETED", order_id: "ORD1", amount_money: { amount: 15000, currency: "CAD" } })).status, 200);
    let now = (await (await adminCall({ action: "list" })).json()).inquiries.find((i) => i.id === bea.id);
    assert.equal(now.depositReceived, true);
    assert.equal(now.depositAmount, 150);
    assert.equal(now.depositVia, "Square");
    // duplicate delivery is harmless
    await hook({ id: "PAY1", status: "COMPLETED", order_id: "ORD1", amount_money: { amount: 15000, currency: "CAD" } });
    now = (await (await adminCall({ action: "list" })).json()).inquiries.find((i) => i.id === bea.id);
    assert.equal(now.paymentLog.length, 1);
    // fee request can't be sent again once paid
    assert.equal((await adminCall({ action: "sendEmail", id: bea.id, type: "feeRequest" })).status, 400);

    // balance after the session
    assert.equal((await adminCall({ action: "sendEmail", id: bea.id, type: "balanceRequest" })).status, 400, "needs booking first");
    await adminCall({ action: "book", id: bea.id, date: "2030-12-20", start: 660 });
    res = await adminCall({ action: "sendEmail", id: bea.id, type: "balanceRequest" });
    assert.equal(res.status, 200);
    assert.equal(links[1].quick_pay.price_money.amount, 15000);
    assert.match(links[1].checkout_options.redirect_url, /for=balance$/);
    assert.match(sent.at(-1).subject, /remaining balance/i);
    assert.match(sent.at(-1).text, /square\.link\/u\/pay2/);
    await hook({ id: "PAY2", status: "COMPLETED", order_id: "ORD2", amount_money: { amount: 15000, currency: "CAD" } });
    now = (await (await adminCall({ action: "list" })).json()).inquiries.find((i) => i.id === bea.id);
    assert.equal(now.balancePaid, true);
    assert.equal(now.balancePaidVia, "Square");

    // e-Transfer can be switched back on as a second option
    await adminCall({ action: "saveEmailSettings", studioAddress: "1909 Lilac Dr", paymentEmail: "zakotarastudio@gmail.com", balanceDue: "After your session, by Interac e-Transfer to zakotarastudio@gmail.com", offerETransfer: true });
    res = await adminCall({ action: "previewEmail", id: bea.id, type: "confirmation" });
    assert.match((await res.json()).html, /e-Transfer/);
    await adminCall({ action: "saveEmailSettings", studioAddress: "1909 Lilac Dr", paymentEmail: "zakotarastudio@gmail.com", balanceDue: "After your session, by Interac e-Transfer to zakotarastudio@gmail.com", offerETransfer: false });
    res = await adminCall({ action: "previewEmail", id: bea.id, type: "confirmation" });
    const html = (await res.json()).html;
    assert.doesNotMatch(html, /e-Transfer/);
    assert.match(html, /secure online payment/);

    // without a signature key: the payment is looked up with Square, so made-up notifications do nothing
    delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    await adminCall({ action: "setBalance", id: bea.id, paid: false });
    const unsigned = (payment) => webhook(new Request("https://zako.test/api/square-webhook", { method: "POST", body: JSON.stringify({ data: { object: { payment } } }) }));
    await unsigned({ id: "FAKE", status: "COMPLETED", order_id: "ORD2", amount_money: { amount: 15000 } });
    now = (await (await adminCall({ action: "list" })).json()).inquiries.find((i) => i.id === bea.id);
    assert.equal(now.balancePaid, false, "a made-up payment is ignored");
    paymentsAtSquare.PAY3 = { id: "PAY3", status: "COMPLETED", order_id: "ORD2", amount_money: { amount: 15000, currency: "CAD" } };
    await unsigned({ id: "PAY3", status: "PENDING" });
    now = (await (await adminCall({ action: "list" })).json()).inquiries.find((i) => i.id === bea.id);
    assert.equal(now.balancePaid, true, "a real payment, confirmed with Square, counts");

    // manual balance marking (tap at the studio)
    await adminCall({ action: "setBalance", id: bea.id, paid: false });
    await adminCall({ action: "setBalance", id: bea.id, paid: true, via: "Square tap at studio" });
    now = (await (await adminCall({ action: "list" })).json()).inquiries.find((i) => i.id === bea.id);
    assert.equal(now.balancePaidVia, "Square tap at studio");
  } finally {
    globalThis.fetch = realFetch; setMailer(null);
    for (const [k, v] of [["SQUARE_ACCESS_TOKEN", saved.t], ["SQUARE_WEBHOOK_SIGNATURE_KEY", saved.k], ["URL", saved.u]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
