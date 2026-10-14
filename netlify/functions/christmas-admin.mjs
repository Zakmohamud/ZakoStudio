const allowedPackages = new Set(["mini", "extended"]);

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

const packageDetails = {
  mini: { minutes: 30, price: 30000, deposit: 15000 },
  extended: { minutes: 60, price: 60000, deposit: 30000 }
};

function vancouverToUtc(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Vancouver",
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).formatToParts(new Date(guess));
  const get = (t) => Number(parts.find((part) => part.type === t).value);
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const utc = guess - (asLocal - guess);
  return new Date(utc);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return jsonResponse(405, { message: "Use POST to manage confirmed sessions." });
  }

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const adminEmail = process.env.CHRISTMAS_ADMIN_EMAIL?.trim().toLowerCase();
  if (!supabaseUrl || !serviceRoleKey || !anonKey || !adminEmail) {
    return jsonResponse(503, { message: "The private booking manager is not configured yet." });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { message: "Send a valid JSON request." });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse(400, { message: "Send a valid JSON request." });
  }

  if (body?.action === "login") {
    if (typeof body.email !== "string" || typeof body.password !== "string") {
      return jsonResponse(400, { message: "Enter your admin email and password." });
    }

    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: anonKey, "content-type": "application/json" },
        body: JSON.stringify({ email: body.email.trim(), password: body.password }),
        signal: AbortSignal.timeout(8000)
      });
      const result = await readResponse(response);
      if (!response.ok || result?.user?.email?.toLowerCase() !== adminEmail || !result.access_token) {
        return jsonResponse(401, { message: "The admin email or password is incorrect." });
      }
      return jsonResponse(200, { accessToken: result.access_token });
    } catch (error) {
      console.error("Unable to authenticate Christmas booking admin.", error);
      return jsonResponse(502, { message: "Admin sign-in is temporarily unavailable. Please try again." });
    }
  }

  if (body?.action === "resetPassword") {
    const resetRedirectUrl = new URL("/christmas-admin.html", request.url).toString();

    try {
      const response = await fetch(
        `${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(resetRedirectUrl)}`,
        {
          method: "POST",
          headers: { apikey: anonKey, "content-type": "application/json" },
          body: JSON.stringify({ email: adminEmail }),
          signal: AbortSignal.timeout(8000)
        }
      );
      const result = await readResponse(response);
      if (!response.ok) {
        console.error("Unable to request Christmas booking admin password reset.", response.status, result);
        return jsonResponse(502, { message: "The password reset email could not be sent. Please try again." });
      }
      return jsonResponse(200, {
        message: "If the configured studio admin email can receive messages, a password reset link was sent there."
      });
    } catch (error) {
      console.error("Unable to send Christmas booking admin password reset.", error);
      return jsonResponse(502, { message: "The password reset email could not be sent. Please try again." });
    }
  }

  const accessToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    return jsonResponse(401, { message: "Sign in to manage confirmed sessions." });
  }

  let user;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000)
    });
    user = await readResponse(response);
    if (!response.ok || !user?.email) {
      return jsonResponse(401, { message: "Your admin session has expired. Sign in again." });
    }
  } catch (error) {
    console.error("Unable to validate Christmas booking admin session.", error);
    return jsonResponse(502, { message: "Admin access could not be verified. Please try again." });
  }

  if (user.email.toLowerCase() !== adminEmail) {
    return jsonResponse(403, { message: "This account is not allowed to manage bookings." });
  }

  if (body.action === "list") {
    const query = new URLSearchParams({
      select: "id,package_id,start_at,end_at,full_name,email,phone",
      status: "eq.confirmed",
      start_at: `gte.${new Date().toISOString()}`,
      order: "start_at.asc",
      limit: "200"
    });

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/christmas_bookings?${query}`, {
        headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
        signal: AbortSignal.timeout(8000)
      });
      const bookings = await readResponse(response);
      if (!response.ok || !Array.isArray(bookings)) {
        console.error("Supabase booking list request failed.", response.status);
        return jsonResponse(502, { message: "Confirmed sessions could not be loaded. Please try again." });
      }
      return jsonResponse(200, { bookings });
    } catch (error) {
      console.error("Unable to reach Supabase for confirmed sessions.", error);
      return jsonResponse(502, { message: "Confirmed sessions could not be loaded. Please try again." });
    }
  }

  if (body.action === "create") {
    const { date, time, packageId, fullName, email, phone } = body;
    if (
      !validDate(date) ||
      typeof time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      !allowedPackages.has(packageId) ||
      typeof fullName !== "string" ||
      !fullName.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof phone !== "string" ||
      !phone.trim()
    ) {
      return jsonResponse(400, { message: "Enter a valid date, time, package, and client contact details." });
    }

    try {
      const details = packageDetails[packageId];
      const startAt = vancouverToUtc(date, time);
      const endAt = new Date(startAt.getTime() + details.minutes * 60000);
      const response = await fetch(`${supabaseUrl}/rest/v1/christmas_bookings`, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
          prefer: "return=representation"
        },
        body: JSON.stringify({
          package_id: packageId,
          package_price_cents: details.price,
          deposit_cents: details.deposit,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          status: "confirmed"
        }),
        signal: AbortSignal.timeout(8000)
      });
      const created = await readResponse(response);
      if (!response.ok) {
        if (created?.code === "23P01" || String(created?.message || "").includes("conflicting key")) {
          return jsonResponse(409, { message: "That time overlaps another confirmed session." });
        }
        console.error("Supabase could not create confirmed booking.", response.status, created);
        const detail = created?.message || created?.hint || `status ${response.status}`;
        return jsonResponse(502, { message: `The session could not be added (${detail}).` });
      }
      return jsonResponse(201, { id: created?.[0]?.id });
    } catch (error) {
      console.error("Unable to create confirmed Christmas booking.", error);
      return jsonResponse(502, { message: `The session could not be added (${error?.message || "unexpected error"}).` });
    }
  }

  if (body.action === "cancel") {
    if (typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)) {
      return jsonResponse(400, { message: "Choose a valid confirmed session." });
    }

    const query = new URLSearchParams({ id: `eq.${body.id}`, status: "eq.confirmed", select: "id" });
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/christmas_bookings?${query}`, {
        method: "PATCH",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
          prefer: "return=representation"
        },
        body: JSON.stringify({ status: "cancelled" }),
        signal: AbortSignal.timeout(8000)
      });
      const updated = await readResponse(response);
      if (!response.ok) {
        console.error("Supabase could not cancel confirmed booking.", response.status, updated);
        return jsonResponse(502, { message: "The session could not be cancelled. Please try again." });
      }
      if (!Array.isArray(updated) || updated.length === 0) {
        return jsonResponse(404, { message: "That confirmed session was not found." });
      }
      return jsonResponse(200, { cancelled: true });
    } catch (error) {
      console.error("Unable to cancel confirmed Christmas booking.", error);
      return jsonResponse(502, { message: "The session could not be cancelled. Please try again." });
    }
  }

  return jsonResponse(400, { message: "Choose a supported booking action." });
}
