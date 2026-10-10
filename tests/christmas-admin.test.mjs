import assert from "node:assert/strict";
import test from "node:test";

import handler from "../netlify/functions/christmas-admin.mjs";

const envKeys = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CHRISTMAS_ADMIN_EMAIL"
];

function request(body, token) {
  return new Request("https://example.test/.netlify/functions/christmas-admin", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

function configure(context, fetchStub) {
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.CHRISTMAS_ADMIN_EMAIL = "studio@example.com";
  globalThis.fetch = fetchStub;
  context.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.fetch = originalFetch;
  });
}

test("rejects methods other than POST", async () => {
  const response = await handler(new Request("https://example.test/admin", { method: "GET" }));

  assert.equal(response.status, 405);
});

test("requires environment configuration", async (context) => {
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  context.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const response = await handler(request({ action: "login" }));

  assert.equal(response.status, 503);
});

test("only allows the configured admin email to sign in", async (context) => {
  configure(context, async (url) => {
    assert.equal(url, "https://project.supabase.co/auth/v1/token?grant_type=password");
    return new Response(JSON.stringify({
      access_token: "access-token",
      user: { email: "studio@example.com" }
    }), { status: 200 });
  });

  const response = await handler(request({
    action: "login",
    email: "studio@example.com",
    password: "correct-password"
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accessToken: "access-token" });
});

test("denies authenticated Supabase users outside the admin email", async (context) => {
  configure(context, async () => new Response(JSON.stringify({ email: "other@example.com" }), { status: 200 }));

  const response = await handler(request({ action: "list" }, "valid-token"));

  assert.equal(response.status, 403);
});

test("lists upcoming confirmed bookings after validating the admin token", async (context) => {
  configure(context, async (url, options) => {
    if (url.endsWith("/auth/v1/user")) {
      assert.equal(options.headers.authorization, "Bearer valid-token");
      return new Response(JSON.stringify({ email: "studio@example.com" }), { status: 200 });
    }
    assert.match(url, /\/rest\/v1\/christmas_bookings\?/);
    assert.match(url, /status=eq\.confirmed/);
    assert.equal(options.headers.apikey, "test-service-role-key");
    return new Response(JSON.stringify([{ id: "booking-id" }]), { status: 200 });
  });

  const response = await handler(request({ action: "list" }, "valid-token"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { bookings: [{ id: "booking-id" }] });
});

test("records a confirmed session through the conflict-safe database function", async (context) => {
  configure(context, async (url, options) => {
    if (url.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ email: "studio@example.com" }), { status: 200 });
    }
    assert.equal(url, "https://project.supabase.co/rest/v1/rpc/admin_create_christmas_booking");
    assert.deepEqual(JSON.parse(options.body), {
      p_service_date: "2026-11-03",
      p_start_time: "10:00",
      p_package_id: "standard-90",
      p_full_name: "Test Client",
      p_email: "client@example.com",
      p_phone: "555-0100"
    });
    return new Response(JSON.stringify("booking-id"), { status: 200 });
  });

  const response = await handler(request({
    action: "create",
    date: "2026-11-03",
    time: "10:00",
    packageId: "standard-90",
    fullName: " Test Client ",
    email: " client@example.com ",
    phone: " 555-0100 "
  }, "valid-token"));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: "booking-id" });
});

test("returns a conflict when another confirmed session overlaps", async (context) => {
  configure(context, async (url) => {
    if (url.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ email: "studio@example.com" }), { status: 200 });
    }
    return new Response(JSON.stringify({ message: "That time overlaps another confirmed session." }), {
      status: 400
    });
  });

  const response = await handler(request({
    action: "create",
    date: "2026-11-03",
    time: "10:00",
    packageId: "standard-90",
    fullName: "Test Client",
    email: "client@example.com",
    phone: "555-0100"
  }, "valid-token"));

  assert.equal(response.status, 409);
});
