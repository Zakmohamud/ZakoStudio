// Client emails for The Christmas Collection 2026.
// Copy is the studio's own wording; values are filled from the request and the admin settings.
// Email clients don't load web fonts, so headings use Georgia (a classic serif) as the closest safe match.
import { squareEnabled } from "./square.mjs";
import { PACKAGE_PRICES, packageIdFromName } from "./referrals.mjs";

const C = {
  ivory: "#F5F0E7",
  card: "#FBF8F2",
  forest: "#243B2E",
  gold: "#AD9361",
  cranberry: "#812E2B",
  ink: "#292622",
  soft: "#5E5850",
  line: "#E2D9C8"
};
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const money = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `$${Number.isInteger(v) ? v : v.toFixed(2)} CAD`;
};

const clock = (m) => {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, "0")} ${h >= 12 ? "p.m." : "a.m."}`;
};

const longDate = (iso) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric"
}).format(new Date(`${iso}T12:00:00Z`));

// Everything an email needs about one request.
export function emailDetails(inquiry, settings) {
  const pkgId = inquiry.packageId || packageIdFromName(inquiry.package);
  const pkg = PACKAGE_PRICES[pkgId];
  const minutes = settings?.durations?.[pkgId] || pkg?.minutes || null;
  const total = Number(inquiry.finalPrice ?? inquiry.price) || 0;
  const pct = Number(settings?.depositPercent ?? 50);
  const fee = inquiry.depositReceived && Number(inquiry.depositAmount)
    ? Number(inquiry.depositAmount)
    : Math.round(total * pct) / 100;
  const dateISO = inquiry.bookedDate || inquiry.dateISO;
  const start = Number.isInteger(inquiry.bookedStart) ? inquiry.bookedStart : inquiry.startMin;
  return {
    firstName: String(inquiry.name || "").trim().split(/\s+/)[0] || "there",
    experience: pkg?.name || inquiry.package || "Your Christmas session",
    date: dateISO ? longDate(dateISO) : inquiry.date || "To be confirmed",
    time: Number.isInteger(start) ? clock(start) : inquiry.time || "To be confirmed",
    duration: minutes ? `${minutes} minutes` : "",
    total: money(total),
    fee: money(fee),
    balance: money(Math.max(total - fee, 0)),
    paymentEmail: settings?.paymentEmail || "zakotarastudio@gmail.com",
    studioAddress: settings?.studioAddress || "",
    balanceDue: balanceDueText(settings),
    payFeeUrl: inquiry.payments?.fee?.url || "",
    payBalanceUrl: inquiry.payments?.balance?.url || "",
    offerETransfer: !squareEnabled() || Boolean(settings?.offerETransfer),
    square: squareEnabled()
  };
}

// With Square on and e-Transfer switched off, an old "by Interac e-Transfer" wording is replaced.
function balanceDueText(settings) {
  const text = settings?.balanceDue || "";
  if (squareEnabled() && !settings?.offerETransfer && /e-?transfer/i.test(text)) return "After your session, by secure online payment (I'll email you a link)";
  return text;
}

const payButton = (url, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 8px;"><tr>
    <td style="background:${C.cranberry};padding:15px 30px;"><a href="${esc(url)}" style="font-family:${SANS};font-size:14px;letter-spacing:2px;text-transform:uppercase;color:${C.ivory};text-decoration:none;">${esc(label)}</a></td></tr></table>`;

// ---------- Shared layout ----------
function layout({ preheader, kicker, title, body }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.ivory};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.ivory};">
<tr><td align="center" style="padding:28px 14px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
    <tr><td style="padding:0 6px 18px;border-bottom:1px solid ${C.ink};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:${SERIF};font-size:22px;color:${C.ink};">Zako Studio</td>
        <td align="right" style="font-family:${SANS};font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:${C.gold};">The Christmas Collection · 2026</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:${C.forest};padding:38px 34px 34px;">
      <p style="margin:0 0 12px;font-family:${SANS};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.gold};">${esc(kicker)}</p>
      <h1 style="margin:0;font-family:${SERIF};font-weight:normal;font-size:34px;line-height:1.15;color:${C.ivory};">${title}</h1>
    </td></tr>
    <tr><td style="background:${C.card};padding:32px 34px 36px;border:1px solid ${C.line};border-top:0;font-family:${SANS};font-size:16px;line-height:1.7;color:${C.ink};">
      ${body}
    </td></tr>
    <tr><td style="padding:22px 6px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.soft};text-align:center;">
      <span style="font-family:${SERIF};font-style:italic;font-size:15px;color:${C.ink};">Christmas, as we remember it.</span><br>
      Zako Studio · Christmas family sessions · Instagram @zakostudi0
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

const p = (html, extra = "") => `<p style="margin:0 0 16px;${extra}">${html}</p>`;
const h2 = (t) => `<p style="margin:26px 0 10px;font-family:${SERIF};font-size:21px;color:${C.forest};">${esc(t)}</p>`;
function rows(items) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;border-top:1px solid ${C.line};">
    ${items.filter(([, v]) => v).map(([k, v, strong]) => `<tr>
      <td style="padding:10px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${C.soft};">${esc(k)}</td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:16px;color:${strong ? C.cranberry : C.ink};${strong ? "font-weight:bold;" : ""}">${esc(v)}</td>
    </tr>`).join("")}
  </table>`;
}
const signoff = (lines) => `<p style="margin:26px 0 0;">${lines.map(esc).join("<br>")}</p>`;

// ---------- 1. Automatic reservation acknowledgement (never implies confirmation) ----------
export function acknowledgementEmail(d) {
  const subject = "We've received your Christmas session request";
  const html = layout({
    preheader: "Your request is with us. We'll be in touch once availability is verified.",
    kicker: "Request received · not yet confirmed",
    title: "Christmas, <em>as we remember it.</em>",
    body:
      p(`Dear ${esc(d.firstName)},`) +
      p("Thank you for choosing Zako Studio to capture a little piece of your Christmas story.") +
      p("We've received your reservation request and will personally review your preferred date and time.") +
      h2("Your request") +
      rows([["Experience", d.experience], ["Preferred date", d.date], ["Preferred time", d.time]]) +
      p(`<span style="font-size:14px;color:${C.soft};">This is a request, not a confirmed booking. Your session is reserved only once availability is verified and your reservation fee is received.</span>`, "margin-top:14px;") +
      p("Once availability is verified, you'll receive an email with your session details and instructions for securing your reservation.") +
      p("We look forward to creating something beautiful with you and your loved ones.") +
      signoff(["With warm regards,", "Zako Studio", "The Christmas Collection · 2026"])
  });
  const text = `Christmas, as we remember it.

Dear ${d.firstName},

Thank you for choosing Zako Studio to capture a little piece of your Christmas story.
We've received your reservation request and will personally review your preferred date and time.

Your request
Experience: ${d.experience}
Preferred date: ${d.date}
Preferred time: ${d.time}

This is a request, not a confirmed booking. Your session is reserved only once availability is verified and your reservation fee is received.

Once availability is verified, you'll receive an email with your session details and instructions for securing your reservation.
We look forward to creating something beautiful with you and your loved ones.

With warm regards,
Zako Studio
The Christmas Collection · 2026`;
  return { subject, html, text };
}

// ---------- 2. Reservation fee request (sent manually after availability is verified) ----------
export function feeRequestEmail(d) {
  const subject = "Your Christmas session is available: secure your reservation";
  const html = layout({
    preheader: `Your ${d.experience} on ${d.date} is available. Here's how to secure it.`,
    kicker: "Availability confirmed",
    title: "Your Christmas session <em>is available.</em>",
    body:
      p(`Dear ${esc(d.firstName)},`) +
      p("I'm delighted to let you know that your preferred Christmas session is available.") +
      p(`<em style="font-family:${SERIF};font-size:18px;color:${C.forest};">A little magic, a little laughter, and beautiful memories await.</em>`) +
      h2("Your Christmas experience") +
      rows([["Experience", d.experience], ["Date", d.date], ["Time", d.time], ["Session duration", d.duration]]) +
      h2("Securing your reservation") +
      rows([["Session total", d.total], ["Reservation fee", d.fee, true], ["Remaining balance", d.balance]]) +
      (d.square
        ? p("When you're ready to commit, secure your session by paying the reservation fee online:", "margin-top:16px;margin-bottom:0;") +
          payButton(d.payFeeUrl || "#", `Pay ${d.fee.replace(" CAD", "")} to reserve`) +
          p(`<span style="font-size:14px;color:${C.soft};">Secure checkout by Square · card, Apple Pay or Google Pay.${d.offerETransfer ? ` Prefer Interac e-Transfer? Send it to <strong>${esc(d.paymentEmail)}</strong> instead.` : ""}</span>`)
        : p(`To secure your session, please send your reservation fee via <strong>Interac e-Transfer</strong> to <strong>${esc(d.paymentEmail)}</strong>.`, "margin-top:16px;")) +
      p("Once your payment has been received, I'll send your official booking confirmation.") +
      p("I look forward to welcoming you and your loved ones.") +
      signoff(["With warm regards,", "Zako Studio", "The Christmas Collection · 2026"])
  });
  const text = `Dear ${d.firstName},

I'm delighted to let you know that your preferred Christmas session is available.
A little magic, a little laughter, and beautiful memories await.

Your Christmas experience
Experience: ${d.experience}
Date: ${d.date}
Time: ${d.time}${d.duration ? `\nSession duration: ${d.duration}` : ""}

Securing your reservation
Session total: ${d.total}
Reservation fee: ${d.fee}
Remaining balance: ${d.balance}

${d.square
  ? `When you're ready to commit, secure your session by paying the reservation fee online:\n${d.payFeeUrl || "(link)"}\nSecure checkout by Square: card, Apple Pay or Google Pay.${d.offerETransfer ? `\nPrefer Interac e-Transfer? Send it to ${d.paymentEmail} instead.` : ""}`
  : `To secure your session, please send your reservation fee via Interac e-Transfer to ${d.paymentEmail}.`}
Once your payment has been received, I'll send your official booking confirmation.

I look forward to welcoming you and your loved ones.

With warm regards,
Zako Studio
The Christmas Collection · 2026`;
  return { subject, html, text };
}

// ---------- 3. Final booking confirmation (sent once the reservation fee is received) ----------
export function confirmationEmail(d) {
  const subject = "Your Christmas experience is officially reserved";
  const html = layout({
    preheader: `Confirmed: ${d.experience} on ${d.date} at ${d.time}.`,
    kicker: "Booking confirmed",
    title: "Officially <em>reserved.</em>",
    body:
      p(`Dear ${esc(d.firstName)},`) +
      p("Your Christmas experience is officially reserved!") +
      p("Soon, we'll be capturing the little moments that make this season so special. The laughter, the warm embraces, the playful expressions and everything in between.") +
      h2("Your Christmas experience") +
      rows([["Experience", d.experience], ["Date", d.date], ["Time", d.time], ["Location", d.studioAddress]]) +
      h2("A little preparation") +
      p("Wear your favourite festive attire, cosy Christmas pyjamas or something a little more elegant. Most importantly, come as yourselves.") +
      p("Please arrive 10 minutes before your scheduled session.") +
      h2("Payment summary") +
      rows([["Reservation fee received", d.fee], ["Remaining balance", d.balance, true], ["Remaining balance due", d.balanceDue]]) +
      p("I can't wait to tell your Christmas story through my lens.", "margin-top:18px;") +
      signoff(["With warm regards,", "Zako Studio", "Christmas, as we remember it."])
  });
  const text = `Dear ${d.firstName},

Your Christmas experience is officially reserved!
Soon, we'll be capturing the little moments that make this season so special. The laughter, the warm embraces, the playful expressions and everything in between.

Your Christmas experience
Experience: ${d.experience}
Date: ${d.date}
Time: ${d.time}${d.studioAddress ? `\nLocation: ${d.studioAddress}` : ""}

A little preparation
Wear your favourite festive attire, cosy Christmas pyjamas or something a little more elegant. Most importantly, come as yourselves.
Please arrive 10 minutes before your scheduled session.

Payment summary
Reservation fee received: ${d.fee}
Remaining balance: ${d.balance}${d.balanceDue ? `\nRemaining balance due: ${d.balanceDue}` : ""}

I can't wait to tell your Christmas story through my lens.

With warm regards,
Zako Studio
Christmas, as we remember it.`;
  return { subject, html, text };
}

// ---------- 3b. Remaining balance (sent after the session) ----------
export function balanceRequestEmail(d) {
  const subject = "Thank you for today: your remaining balance";
  const html = layout({
    preheader: `Thank you for your Christmas session. Your remaining balance is ${d.balance}.`,
    kicker: "Thank you",
    title: "Thank you <em>for today.</em>",
    body:
      p(`Dear ${esc(d.firstName)},`) +
      p("Thank you for letting me be part of your Christmas. It was a joy to photograph you, and I'm already looking forward to sharing your gallery.") +
      h2("Payment summary") +
      rows([["Session total", d.total], ["Reservation fee received", d.fee], ["Remaining balance", d.balance, true]]) +
      (d.square
        ? payButton(d.payBalanceUrl || "#", `Pay ${d.balance.replace(" CAD", "")}`) +
          p(`<span style="font-size:14px;color:${C.soft};">Secure checkout by Square · card, Apple Pay or Google Pay.${d.offerETransfer ? ` Prefer Interac e-Transfer? Send it to <strong>${esc(d.paymentEmail)}</strong> instead.` : ""}</span>`)
        : p(`Please send the remaining balance via <strong>Interac e-Transfer</strong> to <strong>${esc(d.paymentEmail)}</strong>.`, "margin-top:16px;")) +
      p("Your photographs will follow in your private online gallery.", "margin-top:16px;") +
      signoff(["With warm regards,", "Zako Studio", "Christmas, as we remember it."])
  });
  const text = `Dear ${d.firstName},

Thank you for letting me be part of your Christmas. It was a joy to photograph you, and I'm already looking forward to sharing your gallery.

Payment summary
Session total: ${d.total}
Reservation fee received: ${d.fee}
Remaining balance: ${d.balance}

${d.square
  ? `Pay your remaining balance securely online:\n${d.payBalanceUrl || "(link)"}\nSecure checkout by Square: card, Apple Pay or Google Pay.${d.offerETransfer ? `\nPrefer Interac e-Transfer? Send it to ${d.paymentEmail} instead.` : ""}`
  : `Please send the remaining balance via Interac e-Transfer to ${d.paymentEmail}.`}

Your photographs will follow in your private online gallery.

With warm regards,
Zako Studio
Christmas, as we remember it.`;
  return { subject, html, text };
}

// ---------- 4. Gallery ready (sent from Client galleries) ----------
export function galleryEmail({ firstName, link, pin, expiresAt, photoCount }) {
  const subject = "Your Christmas photographs are ready";
  const until = expiresAt ? longDate(expiresAt) : "";
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;"><tr>
    <td style="background:${C.forest};padding:14px 26px;"><a href="${esc(link)}" style="font-family:${SANS};font-size:14px;letter-spacing:2px;text-transform:uppercase;color:${C.ivory};text-decoration:none;">Open your gallery</a></td></tr></table>`;
  const html = layout({
    preheader: "Your private gallery is ready to view and download.",
    kicker: "Your gallery",
    title: "Your photographs <em>are ready.</em>",
    body:
      p(`Dear ${esc(firstName)},`) +
      p(`Your Christmas photographs are ready${photoCount ? ` (${photoCount} of them)` : ""}. They're waiting in your own private gallery, where you can view them, mark your favourites and download them in full resolution.`) +
      button +
      rows([["Gallery", link], ["PIN", pin || ""], ["Open until", until]]) +
      p("Please download your photographs before the gallery closes, and keep a copy somewhere safe.", "margin-top:18px;") +
      p("Thank you for letting me be part of your Christmas.") +
      signoff(["With warm regards,", "Zako Studio", "Christmas, as we remember it."])
  });
  const text = `Dear ${firstName},

Your Christmas photographs are ready${photoCount ? ` (${photoCount} of them)` : ""}. View, favourite and download them in your private gallery:
${link}${pin ? `\nPIN: ${pin}` : ""}${until ? `\nOpen until: ${until}` : ""}

Please download your photographs before the gallery closes, and keep a copy somewhere safe.

Thank you for letting me be part of your Christmas.

With warm regards,
Zako Studio
Christmas, as we remember it.`;
  return { subject, html, text };
}

export const EMAIL_TYPES = {
  acknowledgement: acknowledgementEmail,
  feeRequest: feeRequestEmail,
  confirmation: confirmationEmail,
  balanceRequest: balanceRequestEmail
};

export const EMAIL_LABELS = {
  acknowledgement: "Request received",
  feeRequest: "Reservation fee request",
  confirmation: "Booking confirmation",
  balanceRequest: "Balance request",
  gallery: "Gallery ready"
};

// Adds an entry to the client's email history (newest last) and keeps the
// latest status per type in inquiry.emails for quick checks.
export function logEmail(inquiry, { type, to, subject, error }) {
  const at = new Date().toISOString();
  const entry = { type, label: EMAIL_LABELS[type] || type, to, subject, at, status: error ? "failed" : "sent" };
  if (error) entry.error = String(error).slice(0, 200);
  inquiry.emailLog = [...(inquiry.emailLog || []), entry].slice(-50);
  inquiry.emails = { ...(inquiry.emails || {}), [type]: error ? { error: entry.error, at } : { sentAt: at } };
  return entry;
}
