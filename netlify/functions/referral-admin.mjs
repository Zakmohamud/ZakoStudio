// Private endpoint for the referral-code manager (referral-admin.html).
// Every request must send the REFERRAL_ADMIN_PASSWORD in the x-admin-password header.
import { randomUUID } from "node:crypto";
import { createPaymentLink, deletePaymentLink, squareEnabled, squareStatus } from "../lib/square.mjs";
import { EMAIL_TYPES, emailDetails } from "../lib/emails.mjs";
import { mailReady, mailStatus, sendMail } from "../lib/mail.mjs";
import { logEmail, galleryEmail } from "../lib/emails.mjs";
import { MAX_PHOTOS, VARIANTS, accessToken, deletePhotoFiles, isId, listGalleries, newId, r2Enabled, r2Size, readGallery, uploadUrls, writeGallery } from "../lib/gallery.mjs";
import { keyShape, r2Url } from "../lib/r2.mjs";
import {
  BREAK_MINUTES,
  PACKAGE_PRICES,
  clashes,
  cleanText,
  codesStore,
  formatMinutes,
  inquiriesStore,
  squareOrdersStore,
  isCodeUsable,
  isISODate,
  isMinute,
  isValidCodeFormat,
  jsonResponse,
  normalizeCode,
  packageIdFromName,
  passwordMatches,
  readSchedule,
  readSettings,
  scheduleStore,
  sessionDays,
  eventsStore,
  writeSettings,
  vancouverToday
} from "../lib/referrals.mjs";

export default async function handler(request) {
  if (request.method !== "POST") {
    return jsonResponse(405, { message: "Use POST." });
  }
  if (!process.env.REFERRAL_ADMIN_PASSWORD) {
    return jsonResponse(503, { message: "Set REFERRAL_ADMIN_PASSWORD in Netlify to use the code manager." });
  }
  if (!passwordMatches(request.headers.get("x-admin-password"))) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return jsonResponse(401, { message: "Wrong password." });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { message: "Send a valid JSON request." });
  }

  try {
    const codes = await codesStore();
    const inquiries = await inquiriesStore();
    const schedule = await scheduleStore();

    switch (body?.action) {
      // ---------- Client galleries ----------
      case "listGalleries": {
        const galleries = await listGalleries();
        return jsonResponse(200, { galleries: galleries.map((g) => ({ ...g, token: accessToken(g), photoCount: (g.photos || []).length,
          favourites: (g.photos || []).filter((p) => p.favourite).length, bytes: (g.photos || []).reduce((t, p) => t + (p.files?.full?.size || 0), 0) })) });
      }

      case "createGallery":
      case "updateGallery": {
        const isNew = body.action === "createGallery";
        const g = isNew ? { id: newId(), createdAt: new Date().toISOString(), photos: [], version: 1 } : await readGallery(body.id);
        if (!g) return jsonResponse(404, { message: "Gallery not found." });
        const clientName = cleanText(body.clientName ?? g.clientName, 80);
        if (!clientName) return jsonResponse(400, { message: "Add the client's name." });
        const pin = cleanText(body.pin ?? g.pin ?? "", 12);
        if (pin && !/^\d{4,8}$/.test(pin)) return jsonResponse(400, { message: "A PIN is 4 to 8 digits (or leave it empty)." });
        const expiresAt = body.expiresAt === undefined ? g.expiresAt : body.expiresAt || null;
        if (expiresAt && !isISODate(expiresAt)) return jsonResponse(400, { message: "Pick a valid closing date." });
        if (!isNew && pin !== (g.pin || "")) g.version = (g.version || 1) + 1; // a new PIN invalidates old links' saved access
        Object.assign(g, {
          clientName,
          title: cleanText(body.title ?? g.title ?? "Christmas 2026", 80) || "Christmas 2026",
          message: cleanText(body.message ?? g.message ?? "", 400),
          email: cleanText(body.email ?? g.email ?? "", 120),
          inquiryId: cleanText(body.inquiryId ?? g.inquiryId ?? "", 80),
          pin,
          expiresAt,
          allowDownload: body.allowDownload === undefined ? g.allowDownload !== false : Boolean(body.allowDownload),
          published: body.published === undefined ? Boolean(g.published) : Boolean(body.published)
        });
        await writeGallery(g);
        return jsonResponse(200, { gallery: { ...g, token: accessToken(g) } });
      }

      case "storageCheck": {
        // Writes, reads and deletes a tiny file in Cloudflare R2 to prove the keys work.
        if (!r2Enabled()) return jsonResponse(200, { r2: false });
        const key = `healthcheck/${newId()}`;
        const step = async (method, body) => {
          const res = await fetch(r2Url(method, key, { expires: 120 }), { method, body, headers: body ? { "content-type": "text/plain" } : {} });
          return { status: res.status, body: method === "GET" ? await res.text() : (res.ok ? "" : (await res.text()).slice(0, 300)) };
        };
        const put = await step("PUT", "zako");
        const get = await step("GET");
        const del = await step("DELETE");
        return jsonResponse(200, { r2: true, ok: put.status === 200 && get.body === "zako" && del.status < 300, keys: keyShape(), put: put.status, get: get.status, del: del.status, error: (put.body.match(/<Code>(\w+)/) || [])[1] || null });
      }

      case "galleryUploadUrls": {
        // Where the browser should send a new photo's files: signed Cloudflare R2 links, or (if R2 isn't set up) nothing.
        const g = await readGallery(body.id);
        if (!g) return jsonResponse(404, { message: "Gallery not found." });
        if (!isId(body.photo)) return jsonResponse(400, { message: "Bad photo." });
        if (!r2Enabled()) return jsonResponse(200, { r2: false });
        return jsonResponse(200, { r2: true, urls: uploadUrls(g.id, body.photo) });
      }

      case "addGalleryPhoto": {
        const g = await readGallery(body.id);
        if (!g) return jsonResponse(404, { message: "Gallery not found." });
        const ph = body.photo || {};
        if (!isId(ph.id)) return jsonResponse(400, { message: "Bad photo." });
        if ((g.photos || []).length >= MAX_PHOTOS) return jsonResponse(400, { message: `A gallery holds up to ${MAX_PHOTOS} photos.` });
        const files = {};
        for (const v of VARIANTS) {
          const f = ph.files?.[v];
          if (!f || !Number.isInteger(f.parts) || f.parts < 1 || !Number.isInteger(f.size)) return jsonResponse(400, { message: "Upload incomplete." });
          const type = /^image\/(jpeg|png|webp)$/.test(f.type) ? f.type : "image/jpeg";
          if (f.store === "r2") {
            if (!r2Enabled()) return jsonResponse(400, { message: "Cloudflare R2 isn't set up." });
            const size = await r2Size(g.id, ph.id, v);
            if (size === null) return jsonResponse(400, { message: "Upload incomplete." });
            files[v] = { store: "r2", parts: 1, size, type };
          } else {
            files[v] = { parts: f.parts, size: f.size, type };
          }
        }
        g.photos = [...(g.photos || []).filter((x) => x.id !== ph.id),
          { id: ph.id, name: cleanText(ph.name, 120), w: Number(ph.w) || 0, h: Number(ph.h) || 0, files, addedAt: new Date().toISOString() }];
        await writeGallery(g);
        return jsonResponse(200, { photoCount: g.photos.length });
      }

      case "deleteGalleryPhoto": {
        const g = await readGallery(body.id);
        if (!g) return jsonResponse(404, { message: "Gallery not found." });
        const ph = (g.photos || []).find((x) => x.id === body.photo);
        if (ph) await deletePhotoFiles(g.id, ph);
        g.photos = (g.photos || []).filter((x) => x.id !== body.photo);
        await writeGallery(g);
        return jsonResponse(200, { photoCount: g.photos.length });
      }

      case "deleteGallery": {
        const g = await readGallery(body.id);
        if (!g) return jsonResponse(404, { message: "Gallery not found." });
        for (const ph of g.photos || []) await deletePhotoFiles(g.id, ph);
        const { galleriesStore } = await import("../lib/referrals.mjs");
        await (await galleriesStore()).delete(`g/${g.id}`);
        return jsonResponse(200, { deleted: true });
      }

      case "previewGalleryEmail":
      case "sendGalleryEmail": {
        const g = await readGallery(body.id);
        if (!g) return jsonResponse(404, { message: "Gallery not found." });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email || "")) return jsonResponse(400, { message: "Add the client's email to the gallery first." });
        const origin = new URL(request.url).origin;
        const link = `${origin}/gallery/${g.id}`;
        const mail = galleryEmail({ firstName: /^the\s|family|&| and /i.test(g.clientName) ? g.clientName : g.clientName.split(/\s+/)[0], link, pin: g.pin, expiresAt: g.expiresAt, photoCount: (g.photos || []).length });
        if (body.action === "previewGalleryEmail") return jsonResponse(200, { to: g.email, subject: mail.subject, html: mail.html, mailReady: await mailReady() });
        if (!g.published) return jsonResponse(400, { message: "Turn on “Visible to client” before sending the link." });
        if (!(await mailReady())) return jsonResponse(503, { message: "Email sending isn’t set up yet." });
        try { await sendMail({ to: g.email, ...mail }); }
        catch (error) { return jsonResponse(502, { message: `The email couldn’t be sent: ${String(error.message || error).slice(0, 160)}` }); }
        g.emailLog = [...(g.emailLog || []), { at: new Date().toISOString(), to: g.email }];
        if (g.inquiryId) {
          const inq = await inquiries.get(g.inquiryId, { type: "json" });
          if (inq) { logEmail(inq, { type: "gallery", to: g.email, subject: mail.subject }); await inquiries.setJSON(g.inquiryId, inq); }
        }
        await writeGallery(g);
        return jsonResponse(200, { sent: true });
      }

      case "list": {
        const codeKeys = (await codes.list()).blobs.map((b) => b.key);
        const codeList = (await Promise.all(codeKeys.map((k) => codes.get(k, { type: "json" })))).filter(Boolean);

        const inquiryKeys = (await inquiries.list()).blobs.map((b) => b.key).sort().reverse();
        const inquiryList = (
          await Promise.all(inquiryKeys.slice(0, 300).map((k) => inquiries.get(k, { type: "json" })))
        )
          .filter(Boolean)
          // Inquiries ticked before booking times existed never blocked anything: treat as not booked.
          .map((i) => (i.booked && !i.bookedDate ? { ...i, booked: false, needsTime: true } : i));

        const allForCounts = inquiryKeys.length > 300
          ? (await Promise.all(inquiryKeys.map((k) => inquiries.get(k, { type: "json" })))).filter(Boolean)
          : inquiryList;

        const withStats = codeList
          .map((c) => {
            const used = allForCounts.filter((i) => i.code === c.code);
            return {
              ...c,
              usable: isCodeUsable(c),
              inquiries: used.length,
              booked: used.filter((i) => i.booked && i.bookedDate).length
            };
          })
          .sort((a, b) => a.code.localeCompare(b.code));

        const today = vancouverToday();
        const upcoming = (await readSchedule())
          .filter((e) => e.date >= today)
          .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);

        return jsonResponse(200, {
          codes: withStats,
          inquiries: inquiryList,
          schedule: upcoming,
          packageMinutes: Object.fromEntries(Object.entries(PACKAGE_PRICES).map(([k, v]) => [k, v.minutes])),
          breakMinutes: BREAK_MINUTES
        });
      }

      case "getSettings": {
        const settings = await readSettings();
        return jsonResponse(200, { settings, days: sessionDays(settings), mail: await mailStatus(), square: await squareStatus() });
      }

      case "saveEmailSettings": {
        const settings = await readSettings();
        const paymentEmail = cleanText(body.paymentEmail, 120);
        if (paymentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paymentEmail)) {
          return jsonResponse(400, { message: "Enter a valid e-Transfer email." });
        }
        Object.assign(settings, {
          studioAddress: cleanText(body.studioAddress, 200),
          paymentEmail: paymentEmail || settings.paymentEmail,
          balanceDue: cleanText(body.balanceDue, 200),
          ...(body.offerETransfer === undefined ? {} : { offerETransfer: Boolean(body.offerETransfer) })
        });
        await writeSettings(settings);
        return jsonResponse(200, { settings, days: sessionDays(settings), mail: await mailStatus(), square: await squareStatus() });
      }

      case "previewEmail":
      case "sendEmail": {
        const id = cleanText(body.id, 80);
        const type = body.type;
        const build = EMAIL_TYPES[type];
        if (!build) return jsonResponse(400, { message: "Unknown email." });
        const inquiry = id ? await inquiries.get(id, { type: "json" }) : null;
        if (!inquiry) return jsonResponse(404, { message: "Inquiry not found." });
        const hasTime = (inquiry.bookedDate || inquiry.dateISO) && (Number.isInteger(inquiry.bookedStart) || Number.isInteger(inquiry.startMin));
        if (type === "feeRequest" && !hasTime) {
          return jsonResponse(400, { message: "Add a date and start time first (Mark booked), so the email shows the confirmed time." });
        }
        if (type === "confirmation" && !(inquiry.booked && inquiry.bookedDate && inquiry.depositReceived)) {
          return jsonResponse(400, { message: "Mark the session booked and its reservation fee received before sending the confirmation." });
        }
        if (type === "feeRequest" && inquiry.depositReceived) {
          return jsonResponse(400, { message: "The reservation fee is already marked received." });
        }
        if (type === "balanceRequest" && !(inquiry.booked && inquiry.bookedDate && inquiry.depositReceived)) {
          return jsonResponse(400, { message: "Mark the session booked and its reservation fee received first." });
        }
        if (type === "balanceRequest" && inquiry.balancePaid) return jsonResponse(400, { message: "The balance is already marked paid." });
        const settings = await readSettings();
        const preview = body.action === "previewEmail";
        // A real Square "Pay" link is made when the email is sent (the preview shows a placeholder button).
        if (!preview && squareEnabled() && (type === "feeRequest" || type === "balanceRequest")) {
          const kind = type === "feeRequest" ? "fee" : "balance";
          const d = emailDetails(inquiry, settings);
          const amount = Number((kind === "fee" ? d.fee : d.balance).replace(/[^0-9.]/g, ""));
          if (!(amount > 0)) return jsonResponse(400, { message: "There's nothing to pay for this one." });
          const existing = inquiry.payments?.[kind];
          if (!existing?.url || existing.amount !== amount) {
            try {
              if (existing?.id) await deletePaymentLink(existing.id);
              const origin = new URL(request.url).origin;
              const link = await createPaymentLink({
                name: `Zako Studio · ${kind === "fee" ? "Reservation fee" : "Remaining balance"} · ${d.experience}`,
                amount,
                note: `${kind === "fee" ? "Reservation fee" : "Balance"} · ${inquiry.name || ""} · ${d.date} ${d.time} · ref ${inquiry.id}`,
                email: inquiry.email,
                redirectUrl: `${origin}/christmas/paid/?for=${kind}`
              });
              inquiry.payments = { ...(inquiry.payments || {}), [kind]: { ...link, amount, createdAt: new Date().toISOString() } };
              await (await squareOrdersStore()).setJSON(link.orderId, { inquiryId: inquiry.id, kind, amount });
              await inquiries.setJSON(id, inquiry);
            } catch (error) {
              console.error("Square link failed.", error);
              return jsonResponse(502, { message: `Couldn't make the Square payment link: ${error.message}` });
            }
          }
        }
        let extra = {};
        if (type === "alternativeDate") {
          if (inquiry.booked) return jsonResponse(400, { message: "This session is already booked." });
          if (!isISODate(body.altDate)) return jsonResponse(400, { message: "Pick the date you can offer." });
          const open = sessionDays(settings).some((day) => day.date === body.altDate);
          const pkgId = emailDetails(inquiry, settings).packageId;
          extra = {
            altDate: body.altDate,
            altTimes: cleanText(body.altTimes, 120),
            altLink: open ? `${new URL(request.url).origin}/christmas/book/?date=${body.altDate}${pkgId ? `&package=${pkgId}` : ""}` : ""
          };
        }
        const mail = build({ ...emailDetails(inquiry, settings), ...extra });
        if (preview) {
          return jsonResponse(200, { to: inquiry.email, subject: mail.subject, html: mail.html, mailReady: await mailReady() });
        }
        if (!(await mailReady())) return jsonResponse(503, { message: "Email sending isn’t set up yet. Add GMAIL_USER and GMAIL_APP_PASSWORD in Netlify first." });
        try {
          await sendMail({ to: inquiry.email, ...mail });
        } catch (error) {
          console.error("Client email failed.", error);
          const reason = String(error.message || error).slice(0, 160);
          logEmail(inquiry, { type, to: inquiry.email, subject: mail.subject, error: reason });
          await inquiries.setJSON(id, inquiry);
          return jsonResponse(502, { message: `The email couldn’t be sent: ${reason}` });
        }
        logEmail(inquiry, { type, to: inquiry.email, subject: mail.subject });
        await inquiries.setJSON(id, inquiry);
        return jsonResponse(200, { inquiry });
      }

      case "saveSettings": {
        const settings = await readSettings();
        const buffer = Number(body.bufferMinutes);
        const deposit = Number(body.depositPercent);
        if (!Number.isInteger(buffer) || buffer < 0 || buffer > 60) {
          return jsonResponse(400, { message: "Buffer must be 0–60 minutes." });
        }
        if (!Number.isFinite(deposit) || deposit < 0 || deposit > 100) {
          return jsonResponse(400, { message: "Deposit must be 0–100%." });
        }
        const durations = { ...settings.durations };
        for (const id of Object.keys(PACKAGE_PRICES)) {
          const v = Number(body.durations?.[id]);
          if (body.durations?.[id] !== undefined) {
            if (!Number.isInteger(v) || v < 5 || v > 240) return jsonResponse(400, { message: "Session lengths must be 5–240 minutes." });
            durations[id] = v;
          }
        }
        Object.assign(settings, { bufferMinutes: buffer, depositPercent: deposit, durations });
        await writeSettings(settings);
        return jsonResponse(200, { settings, days: sessionDays(settings) });
      }

      case "saveDay": {
        const settings = await readSettings();
        const { date, start, end } = body;
        const status = body.status === "secured" ? "secured" : "pending";
        if (!isISODate(date) || !isMinute(start) || !isMinute(end) || end <= start) {
          return jsonResponse(400, { message: "Enter a date and opening hours, with the end after the start." });
        }
        const days = Array.isArray(settings.days) ? [...settings.days] : [];
        const i = days.findIndex((d) => d.date === date);
        const day = { date, start, end, status };
        if (i >= 0) days[i] = day; else days.push(day);
        settings.hiddenDays = (settings.hiddenDays || []).filter((d) => d !== date);
        settings.days = days.sort((a, b) => a.date.localeCompare(b.date));
        await writeSettings(settings);
        return jsonResponse(200, { settings, days: sessionDays(settings) });
      }

      case "saveAutoDays": {
        const settings = await readSettings();
        if (body.seasonEnd !== undefined) {
          if (!isISODate(body.seasonEnd)) return jsonResponse(400, { message: "Enter the last day of the season." });
          settings.seasonEnd = body.seasonEnd;
        }
        if (body.autoWeekends !== undefined) settings.autoWeekends = Boolean(body.autoWeekends);
        if (body.restoreHidden) settings.hiddenDays = [];
        await writeSettings(settings);
        return jsonResponse(200, { settings, days: sessionDays(settings) });
      }

      case "removeDay": {
        const settings = await readSettings();
        settings.days = (Array.isArray(settings.days) ? settings.days : []).filter((d) => d.date !== body.date);
        if (isISODate(body.date)) settings.hiddenDays = [...new Set([...(settings.hiddenDays || []), body.date])];
        await writeSettings(settings);
        return jsonResponse(200, { settings, days: sessionDays(settings) });
      }

      case "analytics": {
        // Period: a single day ("day"), a from/to range, or the last N days. Also returns the period just before it
        // (same length) for comparison, and visitors per day.
        const includePreview = Boolean(body.includePreview);
        const isLive = (ctx) => includePreview || !ctx || ctx === "production" || ctx === "unknown";
        const sourceKey = (utm) => [utm?.source, utm?.campaign].filter(Boolean).join(" / ") || "direct / unknown";
        const store = await eventsStore();
        const today = vancouverToday();
        const shift = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
        let to = today, from;
        if (isISODate(body.day)) { from = to = body.day > today ? today : body.day; }
        else if (isISODate(body.from) && isISODate(body.to) && body.from <= body.to) { from = body.from; to = body.to > today ? today : body.to; }
        else { from = shift(today, -(Math.min(Math.max(Number(body.days) || 14, 1), 90) - 1)); }
        const span = Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 864e5) + 1;
        if (span > 120) return jsonResponse(400, { message: "Pick a period of 120 days or less." });
        const datesBetween = (a, b) => { const out = []; for (let d = b; d >= a; d = shift(d, -1)) out.push(d); return out; };
        const vanDate = (iso) => iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver" }).format(new Date(iso)) : "";

        const inqKeys = (await inquiries.list()).blobs.map((b) => b.key);
        const allInq = (await Promise.all(inqKeys.map((k) => inquiries.get(k, { type: "json" })))).filter(Boolean)
          .filter((i) => isLive(i.ctx));
        const settings = await readSettings();
        const spend = settings.adSpend || {};

        async function period(dates) {
        const since = dates[dates.length - 1], until = dates[0];
        const keys = [];
        for (const d of dates) keys.push(...(await store.list({ prefix: `${d}/` })).blobs.map((b) => b.key));
        const events = (await Promise.all(keys.map(async (k) => { const ev = await store.get(k, { type: "json" }); return ev && { ...ev, day: k.slice(0, 10) }; })))
          .filter(Boolean)
          .filter((ev) => isLive(ev.ctx));
        const perDay = {};
        for (const ev of events) if (ev.e === "landing_view" || ev.e === "booking_view") (perDay[ev.day] ||= new Set()).add(ev.s);
        const sets = {};                 // event -> Set(session)
        const bySource = {};             // source -> { visitors:Set, requests, confirmed, revenue }
        const pkgPicks = {};             // pkg -> unique sessions that picked it
        const src = (k) => (bySource[k] ||= { visitors: new Set(), clicks: new Set(), starts: new Set(), requests: 0, confirmed: 0, revenue: 0 });
        for (const ev of events) {
          (sets[ev.e] ||= new Set()).add(ev.s);
          const k = sourceKey(ev.utm);
          if (ev.e === "landing_view" || ev.e === "booking_view") src(k).visitors.add(ev.s);
          if (ev.e === "cta_click") src(k).clicks.add(ev.s);
          if (ev.e === "form_start") src(k).starts.add(ev.s);
          if (ev.e === "package_select" && ev.pkg) (pkgPicks[ev.pkg] ||= new Set()).add(ev.s);
        }
        // Funnel is cumulative: anyone who reached a later step also passed the earlier ones
        // (e.g. a hero date link skips "chose a date").
        const order = ["booking_view", "package_select", "date_select", "time_select", "form_start", "form_submit"];
        for (let i = order.length - 2; i >= 0; i--) {
          const later = sets[order[i + 1]];
          if (later) sets[order[i]] = new Set([...(sets[order[i]] || []), ...later]);
        }
        const u = (e) => sets[e]?.size || 0;

        // Requests and bookings come from the inquiries themselves, not page events.
        const periodInq = allInq.filter((i) => { const d = vanDate(i.createdAt); return d >= since && d <= until; });
        const pkgRequests = {};
        const pkgBooked = {};
        for (const i of periodInq) {
          const k = sourceKey(i.utm);
          const pid = i.packageId || packageIdFromName(i.package) || "other";
          src(k).requests += 1;
          pkgRequests[pid] = (pkgRequests[pid] || 0) + 1;
          if (i.booked && i.bookedDate) {
            src(k).confirmed += 1;
            src(k).revenue += Number(i.finalPrice ?? i.price) || 0;
            pkgBooked[pid] = (pkgBooked[pid] || 0) + 1;
          }
        }

        for (const k of Object.keys(spend)) src(k);
        const sources = Object.fromEntries(Object.entries(bySource).map(([k, v]) => {
          const adSpend = Number(spend[k]) || 0;
          return [k, {
            visitors: v.visitors.size,
            reserveClicks: v.clicks.size,
            formStarts: v.starts.size,
            requests: v.requests,
            confirmed: v.confirmed,
            revenue: Math.round(v.revenue * 100) / 100,
            adSpend,
            cac: v.confirmed ? Math.round((adSpend / v.confirmed) * 100) / 100 : null
          }];
        }));

        const visitors = new Set([...(sets.landing_view || []), ...(sets.booking_view || [])]).size;
        const requests = periodInq.length;
        const confirmed = periodInq.filter((i) => i.booked && i.bookedDate).length;
        const totalSpend = Object.values(spend).reduce((t, n) => t + (Number(n) || 0), 0);
        return {
          span,
          since,
          until,
          daily: dates.map((d) => ({ date: d, visitors: perDay[d]?.size || 0, requests: periodInq.filter((i) => vanDate(i.createdAt) === d).length })),
          visitors,
          landingVisitors: u("landing_view"),
          funnel: [
            ["Visited the campaign", visitors],
            ["Opened booking", u("booking_view")],
            ["Chose an experience", u("package_select")],
            ["Chose a date", u("date_select")],
            ["Chose a time", u("time_select")],
            ["Started their details", u("form_start")],
            ["Sent a request", u("form_submit")]
          ],
          instagramClicks: u("instagram_click"),
          requests,
          confirmed,
          conversion: visitors ? Math.round((requests / visitors) * 1000) / 10 : null,
          bookingConversion: visitors ? Math.round((confirmed / visitors) * 1000) / 10 : null,
          packages: Object.fromEntries(Object.keys(PACKAGE_PRICES).map((id) => [id, {
            name: PACKAGE_PRICES[id].name,
            picked: pkgPicks[id]?.size || 0,
            requests: pkgRequests[id] || 0,
            booked: pkgBooked[id] || 0
          }])),
          sources,
          totalSpend,
          revenue: Math.round(periodInq.filter((i) => i.booked && i.bookedDate).reduce((t, i) => t + (Number(i.finalPrice ?? i.price) || 0), 0) * 100) / 100,
          cac: confirmed ? Math.round((totalSpend / confirmed) * 100) / 100 : null
        };
        }

        const current = await period(datesBetween(from, to));
        const prev = await period(datesBetween(shift(from, -span), shift(from, -1)));
        return jsonResponse(200, {
          ...current,
          previous: { since: prev.since, until: prev.until, visitors: prev.visitors, requests: prev.requests, confirmed: prev.confirmed, revenue: prev.revenue,
            funnel: prev.funnel, daily: prev.daily }
        });
      }

      case "saveAdSpend": {
        const settings = await readSettings();
        const key = cleanText(body.key, 120);
        if (!key) return jsonResponse(400, { message: "Enter the source / campaign this spend belongs to." });
        const amount = Number(body.amount);
        const adSpend = { ...(settings.adSpend || {}) };
        if (body.amount === null || body.amount === "" || amount === 0) delete adSpend[key];
        else if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return jsonResponse(400, { message: "Enter an amount in dollars." });
        else adSpend[key] = Math.round(amount * 100) / 100;
        settings.adSpend = adSpend;
        await writeSettings(settings);
        return jsonResponse(200, { adSpend });
      }

      case "squareTest": {
        // $1 test payment: makes a link, and later reports whether the site heard about the payment.
        if (!squareEnabled()) return jsonResponse(400, { message: "Square isn't set up." });
        const orders = await squareOrdersStore();
        if (body.check) {
          const ref = await orders.get(cleanText(body.check, 80), { type: "json" });
          return jsonResponse(200, { paid: Boolean(ref?.paidAt), paidAt: ref?.paidAt || null, amount: ref?.paidAmount ?? null });
        }
        const origin = new URL(request.url).origin;
        const link = await createPaymentLink({ name: "Zako Studio · $1 test payment", amount: 1, note: "Website test payment (refund me)", redirectUrl: `${origin}/christmas/paid/?for=fee` });
        await orders.setJSON(link.orderId, { kind: "test", amount: 1 });
        return jsonResponse(200, { url: link.url, orderId: link.orderId });
      }

      case "setBalance": {
        // Marks the remaining balance paid by hand (e.g. tapped in person at the studio).
        const id = cleanText(body.id, 80);
        const inquiry = id ? await inquiries.get(id, { type: "json" }) : null;
        if (!inquiry) return jsonResponse(404, { message: "Inquiry not found." });
        inquiry.balancePaid = Boolean(body.paid);
        inquiry.balancePaidAt = inquiry.balancePaid ? new Date().toISOString() : null;
        inquiry.balancePaidVia = inquiry.balancePaid ? cleanText(body.via, 40) || "marked by you" : null;
        await inquiries.setJSON(id, inquiry);
        return jsonResponse(200, { inquiry });
      }

      case "setDeposit": {
        const id = cleanText(body.id, 80);
        const inquiry = id ? await inquiries.get(id, { type: "json" }) : null;
        if (!inquiry) return jsonResponse(404, { message: "Inquiry not found." });
        const received = Boolean(body.received);
        const amount = body.amount === undefined || body.amount === null || body.amount === "" ? null : Number(body.amount);
        if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 10000)) {
          return jsonResponse(400, { message: "Enter the deposit amount in dollars." });
        }
        Object.assign(inquiry, {
          depositReceived: received,
          depositAmount: amount ?? inquiry.depositAmount ?? null,
          depositUpdatedAt: new Date().toISOString()
        });
        await inquiries.setJSON(id, inquiry);
        return jsonResponse(200, { inquiry });
      }

      case "saveCode": {
        const code = normalizeCode(body.code);
        const partner = cleanText(body.partner, 80);
        const type = body.type === "amount" ? "amount" : "percent";
        const percent = Number(body.percent);
        const amount = Math.round(Number(body.amount) * 100) / 100;
        const expires = cleanText(body.expires, 10);
        if (!isValidCodeFormat(code)) {
          return jsonResponse(400, { message: "Codes use 3–24 letters, numbers, or dashes (e.g. SARAH15)." });
        }
        if (!partner) return jsonResponse(400, { message: "Enter who the code belongs to." });
        if (type === "percent" && (!Number.isInteger(percent) || percent < 1 || percent > 90)) {
          return jsonResponse(400, { message: "A % discount must be a whole number from 1 to 90." });
        }
        if (type === "amount" && (!Number.isFinite(amount) || amount <= 0 || amount > 500)) {
          return jsonResponse(400, { message: "A $ discount must be between $1 and $500." });
        }
        if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
          return jsonResponse(400, { message: "Expiry must be a date." });
        }
        const existing = await codes.get(code, { type: "json" });
        if (existing && body.isNew) {
          return jsonResponse(409, { message: `${code} already exists. Edit it in the list instead.` });
        }
        const record = {
          code,
          partner,
          type,
          ...(type === "percent" ? { percent } : { amount }),
          expires: expires || null,
          active: body.active !== false,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await codes.setJSON(code, record);
        return jsonResponse(200, { code: record });
      }

      case "deleteCode": {
        const code = normalizeCode(body.code);
        if (!isValidCodeFormat(code)) return jsonResponse(400, { message: "Unknown code." });
        await codes.delete(code);
        return jsonResponse(200, { deleted: code });
      }

      case "book": {
        const id = cleanText(body.id, 80);
        const inquiry = id ? await inquiries.get(id, { type: "json" }) : null;
        if (!inquiry) return jsonResponse(404, { message: "Inquiry not found." });
        const date = body.date;
        const start = body.start;
        if (!isISODate(date) || !isMinute(start)) {
          return jsonResponse(400, { message: "Enter the date and start time you agreed with the client." });
        }
        const pkgId = inquiry.packageId || packageIdFromName(inquiry.package);
        const settings = await readSettings();
        const minutes = settings.durations[pkgId] || PACKAGE_PRICES[pkgId]?.minutes;
        if (!minutes) return jsonResponse(400, { message: "Unknown package length for this inquiry." });
        const end = start + minutes;
        if (end > 1440) return jsonResponse(400, { message: "That session would run past midnight." });

        const sameDay = (await readSchedule()).filter((e) => e.date === date);
        const clash = clashes(sameDay, start, end, id, settings.bufferMinutes);
        if (clash) {
          return jsonResponse(409, {
            message: `That overlaps ${clash.label || "another booking"} (${formatMinutes(clash.start)}–${formatMinutes(clash.end)}) including your ${settings.bufferMinutes}-minute buffer.`
          });
        }

        await schedule.setJSON(id, {
          id,
          date,
          start,
          end,
          kind: "session",
          label: `${inquiry.name} · ${inquiry.package}`
        });
        Object.assign(inquiry, { booked: true, bookedDate: date, bookedStart: start, bookedEnd: end });
        await inquiries.setJSON(id, inquiry);
        return jsonResponse(200, { inquiry });
      }

      case "unbook": {
        const id = cleanText(body.id, 80);
        const inquiry = id ? await inquiries.get(id, { type: "json" }) : null;
        if (!inquiry) return jsonResponse(404, { message: "Inquiry not found." });
        await schedule.delete(id);
        Object.assign(inquiry, { booked: false, bookedDate: null, bookedStart: null, bookedEnd: null });
        await inquiries.setJSON(id, inquiry);
        return jsonResponse(200, { inquiry });
      }

      case "block": {
        const date = body.date;
        const wholeDay = Boolean(body.wholeDay);
        const start = wholeDay ? 0 : body.start;
        const end = wholeDay ? 1440 : body.end;
        if (!isISODate(date)) return jsonResponse(400, { message: "Choose a date to block." });
        if (!isMinute(start) || !isMinute(end) || end <= start) {
          return jsonResponse(400, { message: "Enter a start and end time, with the end after the start." });
        }
        const id = `block-${randomUUID().slice(0, 12)}`;
        const entry = { id, date, start, end, kind: "block", label: cleanText(body.note, 80) || "Blocked" };
        await schedule.setJSON(id, entry);
        return jsonResponse(200, { entry });
      }

      case "unblock": {
        const id = cleanText(body.id, 80);
        if (!id.startsWith("block-")) return jsonResponse(400, { message: "Only manual blocks can be removed here." });
        await schedule.delete(id);
        return jsonResponse(200, { deleted: id });
      }

      case "deleteInquiry": {
        const id = cleanText(body.id, 80);
        if (!id) return jsonResponse(400, { message: "Unknown inquiry." });
        await inquiries.delete(id);
        await schedule.delete(id);
        return jsonResponse(200, { deleted: id });
      }

      default:
        return jsonResponse(400, { message: "Unknown action." });
    }
  } catch (error) {
    console.error("Referral admin request failed.", error);
    return jsonResponse(502, { message: "Something went wrong talking to storage. Please try again." });
  }
}
