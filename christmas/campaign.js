/* The Christmas Collection by Zako Studio — shared settings, tracking and helpers.
   Edit CAMPAIGN below to update details shown on the landing and booking pages. */

window.CAMPAIGN = {
  instagram: "zakarymaxamed",
  city: "Vancouver",
  fromPrice: 190,

  // ---- Details you haven't confirmed yet. Leave null to show the neutral wording. ----
  studioArea: null,          // e.g. "Kitsilano, Vancouver" — the exact address is only sent after confirming
  deliveryTime: null,        // e.g. "within 2 weeks of your session"
  reschedulePolicy: null,    // e.g. "You can move your session once, up to 48 hours before, at no cost."
  maxCouplesNote: null,      // optional extra line for couples

  // ---- The experiences (prices are fixed; session lengths can be changed in the admin page) ----
  packages: {
    quick: {
      name: "The Keepsake",
      price: 190,
      minutes: 15,
      images: "10+",
      people: 5,
      line: "A little Christmas magic, beautifully preserved. Perfect for a timeless family portrait or a few meaningful moments together.",
      photo: "/christmas/img/pkg-keepsake",
      alt: "A family of three hugging on a bench beside a white-and-gold Christmas tree"
    },
    mini: {
      name: "The Story",
      price: 300,
      minutes: 30,
      images: "20+",
      people: 5,
      line: "More time to relax, explore and capture the personalities and connections that make your family unique.",
      photo: "/christmas/img/pkg-story",
      alt: "A brother and sister sharing cookies and hot chocolate by the fireplace"
    },
    extended: {
      name: "The Heirloom",
      price: 600,
      minutes: 60,
      images: "40+",
      people: 7,
      line: "An extended photographic experience designed to tell a richer, more personal Christmas story.",
      photo: "/christmas/img/pkg-heirloom",
      alt: "A family in evening wear smiling together beside the Christmas tree"
    }
  }
};

(function () {
  const store = (() => {
    try { const s = window.sessionStorage; s.setItem("_t", "1"); s.removeItem("_t"); return s; }
    catch { return null; }
  })();
  const get = (k) => { try { return store ? store.getItem(k) : null; } catch { return null; } };
  const set = (k, v) => { try { store && store.setItem(k, v); } catch {} };

  // Anonymous id for this browser tab only (no cookies, cleared when the tab closes).
  let sid = get("zs_sid");
  if (!sid) {
    sid = Math.random().toString(36).slice(2, 12);
    set("zs_sid", sid);
  }

  // Campaign source from UTM parameters (first one seen in this tab wins).
  const params = new URLSearchParams(location.search);
  const fromUrl = {
    source: params.get("utm_source"),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
    content: params.get("utm_content")
  };
  if (fromUrl.source || fromUrl.campaign) {
    if (!get("zs_utm")) set("zs_utm", JSON.stringify(fromUrl));
  } else if (!get("zs_utm") && /instagram|facebook|fbclid/i.test(document.referrer + location.search)) {
    set("zs_utm", JSON.stringify({ source: /facebook/i.test(document.referrer) ? "facebook" : "instagram", medium: "referral" }));
  }
  const utm = (() => { try { return JSON.parse(get("zs_utm") || "{}"); } catch { return {}; } })();

  // Devices marked "don't count me" on the bookings page are never tracked.
  const internal = (() => { try { return localStorage.getItem("zs_internal") === "1"; } catch { return false; } })();

  const sent = new Set();
  function track(e, extra = {}, once = false) {
    if (internal) return;
    if (once) {
      const key = `${e}:${extra.pkg || ""}`;
      if (sent.has(key) || get(`zs_once_${key}`)) return;
      sent.add(key);
      set(`zs_once_${key}`, "1");
    }
    const body = JSON.stringify({ e, s: sid, p: location.pathname, pkg: extra.pkg || null, utm });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }))) return;
    } catch {}
    try { fetch("/api/track", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {}); } catch {}
  }

  // Any element with data-track="event" (and optional data-pkg) is tracked on click.
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-track]");
    if (el) track(el.dataset.track, { pkg: el.dataset.pkg });
  });

  const money = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

  // Open start times on a session day, kept next to existing bookings so families are
  // booked back to back (each rented studio hour is used well). On an empty day the
  // first few consecutive slots from opening are offered.
  function openTimes(day, busy, dur, buf) {
    const taken = (busy[day.date] || []).filter(([s, e]) => e > day.start && s < day.end);
    const fits = (s) => s >= day.start && s + dur <= day.end && !taken.some(([bs, be]) => s < be + buf && bs < s + dur + buf);
    const cands = new Set();
    if (!taken.length) {
      for (let k = 0; k < 3; k++) cands.add(day.start + k * (dur + buf));
    } else {
      cands.add(day.start);
      for (const [bs, be] of taken) {
        cands.add(be + buf);
        cands.add(be + buf + dur + buf);
        cands.add(bs - buf - dur);
      }
    }
    return [...cands].filter(fits).sort((a, b) => a - b);
  }

  const clock = (m) => { const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, "0")} ${h >= 12 ? "p.m." : "a.m."}`; };
  const fmtDate = (iso, o) => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", ...o }).format(new Date(`${iso}T12:00:00Z`));

  window.ZS = {
    track, utm, sid, money, openTimes, clock, fmtDate,
    instagramUrl: `https://instagram.com/${window.CAMPAIGN.instagram}`,
    // Opens a direct message in the Instagram app (works inside Instagram's in-app browser too).
    dmUrl: `https://ig.me/m/${window.CAMPAIGN.instagram}`
  };
})();
