const allowedPackages = new Set(["quick", "mini", "extended"]);

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

const localParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Vancouver",
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
});

function localMinutes(value) {
  const parts = Object.fromEntries(localParts.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

async function busyRanges(supabaseUrl, serviceRoleKey, serviceDate) {
  const from = new Date(`${serviceDate}T00:00:00Z`);
  const to = new Date(from.getTime() + 36 * 3600000);
  const query = new URLSearchParams({
    select: "start_at,end_at",
    status: "eq.confirmed",
    end_at: `gt.${from.toISOString()}`
  });
  query.append("start_at", `lt.${to.toISOString()}`);
  const response = await fetch(`${supabaseUrl}/rest/v1/christmas_bookings?${query}`, {
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Invalid bookings response");
  return rows
    .map((row) => ({ start: localMinutes(row.start_at), end: localMinutes(row.end_at) }))
    .filter((row) => row.start.date === serviceDate)
    .map((row) => ({ start: row.start.minutes, end: row.end.date === serviceDate ? row.end.minutes : 1440 }));
}

export default async function handler(request) {
  if (request.method !== "GET") {
    return jsonResponse(405, { message: "Use GET to check available times." });
  }

  const url = new URL(request.url);
  const packageId = url.searchParams.get("package");
  const serviceDate = url.searchParams.get("date");
  const parsedServiceDate = serviceDate ? new Date(`${serviceDate}T00:00:00Z`) : null;

  if (!allowedPackages.has(packageId)) {
    return jsonResponse(400, { message: "Choose a valid session package." });
  }

  if (
    !serviceDate ||
    !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) ||
    Number.isNaN(parsedServiceDate.getTime()) ||
    parsedServiceDate.toISOString().slice(0, 10) !== serviceDate
  ) {
    return jsonResponse(400, { message: "Choose a valid booking date." });
  }

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(503, {
      message: "Online availability is not connected yet. Please contact Zako Studio to inquire."
    });
  }

  try {
    const busy = await busyRanges(supabaseUrl, serviceRoleKey, serviceDate);
    return jsonResponse(200, { slots: [], busy });
  } catch (error) {
    console.error("Unable to reach Supabase for Christmas availability.", error);
    return jsonResponse(502, { message: "Availability could not be checked. Please try again later." });
  }
}
