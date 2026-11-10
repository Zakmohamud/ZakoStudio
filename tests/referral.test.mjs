import assert from "node:assert/strict";
import test from "node:test";

import { setStoreFactory } from "../netlify/lib/referrals.mjs";
import referral from "../netlify/functions/referral.mjs";
import admin from "../netlify/functions/referral-admin.mjs";
import schedule from "../netlify/functions/schedule.mjs";

function memoryStores() {
  const stores = new Map();
  return (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    return {
      async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
      async setJSON(key, value) { data.set(key, structuredClone(value)); return { modified: true }; },
      async delete(key) { data.delete(key); },
      async list() { return { blobs: [...data.keys()].map((key) => ({ key })) }; }
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
  assert.deepEqual(await res.json(), { valid: true, code: "SARAH15", percent: 15 });

  res = await referral(new Request("https://x.test/api/referral?code=NOPE99"));
  assert.equal((await res.json()).valid, false);

  res = await referral(new Request("https://x.test/api/referral", {
    method: "POST",
    body: JSON.stringify({ package: "mini", name: "Ana", email: "ana@example.com", code: "SARAH15" })
  }));
  assert.deepEqual(await res.json(), { saved: true, percent: 15, finalPrice: 255 });

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
