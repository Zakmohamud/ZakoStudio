import assert from "node:assert/strict";
import test from "node:test";

import { setStoreFactory } from "../netlify/lib/referrals.mjs";
import referral from "../netlify/functions/referral.mjs";
import admin from "../netlify/functions/referral-admin.mjs";

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
  assert.equal((await res.json()).finalPrice, 175);

  const list = await (await adminCall({ action: "list" })).json();
  assert.equal(list.inquiries.length, 2);
  const sarah = list.codes.find((c) => c.code === "SARAH15");
  assert.equal(sarah.inquiries, 1);
  assert.equal(sarah.booked, 0);

  const ana = list.inquiries.find((i) => i.name === "Ana");
  assert.equal(ana.partner, "Sarah");
  await adminCall({ action: "setBooked", id: ana.id, booked: true });
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
