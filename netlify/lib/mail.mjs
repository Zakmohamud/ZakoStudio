// Sends client emails from the studio's Gmail using a Google "App password".
// Credentials live only in Netlify's server-side environment variables:
//   GMAIL_USER          e.g. zakotarastudio@gmail.com
//   GMAIL_APP_PASSWORD  the 16-letter App password (mark it "secret" in Netlify)
// They are never stored in Blobs or sent to a browser.

let mailer = null;

// Tests swap in a fake sender.
export function setMailer(fn) {
  mailer = fn;
}

function credentials() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  return user && pass ? { user, pass } : null;
}

export async function mailStatus() {
  if (mailer) return { ready: true, user: "test" };
  const c = credentials();
  return c ? { ready: true, user: c.user } : { ready: false };
}

export const mailReady = async () => (await mailStatus()).ready;

export async function sendMail({ to, subject, html, text, replyTo }) {
  if (mailer) return mailer({ to, subject, html, text, replyTo });
  const c = credentials();
  if (!c) throw new Error("Email sending isn't set up yet: add GMAIL_USER and GMAIL_APP_PASSWORD in Netlify.");
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: c.user, pass: String(c.pass).replace(/\s+/g, "") }
  });
  const info = await transport.sendMail({
    from: { name: "Zako Studio", address: c.user },
    replyTo: replyTo || c.user,
    to,
    subject,
    html,
    text
  });
  return { id: info.messageId };
}
