const allowedPackages = new Set(["mini", "standard-60", "standard-90", "extended"]);

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
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
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/christmas_available_slots`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        p_service_date: serviceDate,
        p_package_id: packageId
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.error("Supabase availability request failed.", response.status, responseText);
      return jsonResponse(502, { message: "Availability could not be checked. Please try again later." });
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.some((row) => typeof row.slot_start !== "string")) {
      console.error("Supabase returned an invalid availability response.");
      return jsonResponse(502, { message: "Availability could not be checked. Please try again later." });
    }

    return jsonResponse(200, { slots: rows.map((row) => row.slot_start) });
  } catch (error) {
    console.error("Unable to reach Supabase for Christmas availability.", error);
    return jsonResponse(502, { message: "Availability could not be checked. Please try again later." });
  }
}
