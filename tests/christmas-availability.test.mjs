import assert from "node:assert/strict";
import test from "node:test";

import handler from "../netlify/functions/christmas-availability.mjs";

function request(method = "GET", query = "") {
  return new Request(`https://example.test/.netlify/functions/christmas-availability${query}`, { method });
}

test("rejects methods other than GET", async () => {
  const response = await handler(request("POST"));

  assert.equal(response.status, 405);
  assert.equal((await response.json()).message, "Use GET to check available times.");
});

test("rejects invalid package and date inputs", async () => {
  const invalidPackage = await handler(request("GET", "?package=unknown&date=2026-10-10"));
  const invalidDate = await handler(request("GET", "?package=mini&date=2026-02-30"));

  assert.equal(invalidPackage.status, 400);
  assert.equal(invalidDate.status, 400);
});

test("returns an explicit setup message when Supabase is not configured", async (context) => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  context.after(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  const response = await handler(request("GET", "?package=mini&date=2026-10-10"));

  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /not connected yet/);
});

test("returns validated slot data from Supabase", async (context) => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = "https://project.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://project.supabase.co/rest/v1/rpc/christmas_available_slots");
    assert.equal(options.headers.apikey, "test-service-role-key");
    assert.deepEqual(JSON.parse(options.body), {
      p_service_date: "2026-10-10",
      p_package_id: "mini"
    });
    return new Response(JSON.stringify([{ slot_start: "2026-10-10T17:00:00+00:00" }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  context.after(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  const response = await handler(request("GET", "?package=mini&date=2026-10-10"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { slots: ["2026-10-10T17:00:00+00:00"] });
});
