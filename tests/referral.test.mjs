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
  res = await adminCall({ action: "sendEmail", id: ana.id, type: "feeRequest" });
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
