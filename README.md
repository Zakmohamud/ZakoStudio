# ProjectXzylo
# ProjectXzylo
# ZakoStudio

## Booking inquiries

The portfolio inquiry form submits to the studio inbox through FormSubmit. Christmas package inquiries are emailed directly to `zakotarastudio@gmail.com`, include the selected package and requested date/time, and return to the package page after submission. Christmas inquiries do not send an automatic reply to the client. An inquiry is not a reserved session.

The studio inbox must approve FormSubmit's one-time activation email before submissions are delivered. Keep FormSubmit's reCAPTCHA enabled; autoresponse emails are not supported for AJAX submissions or when reCAPTCHA is disabled.

## Christmas family-session bookings

Share the Christmas package page in Instagram and Facebook ads: <https://zako-studio.netlify.app/christmas-booking.html>. The floating “Christmas family sessions” button on the portfolio opens this page. Each package has its own detail URL through a `package` query parameter.

Packages: 30-minute Mini, $200 CAD, 5–10 edited images; 1-hour Standard, $350 CAD, 15–25 edited images; 1.5-hour Standard, $450 CAD, 15–25 edited images; and 2-hour Extended, $650 CAD, 30–50 edited images. A 50% deposit is required before a booking is confirmed; its amount is explained at the end of the inquiry form. The photographer follows up by email to confirm availability and arrange the deposit. Submitting an inquiry does not reserve a date or charge the client.

### Booking-system setup

The Christmas page currently accepts email inquiries through FormSubmit; the requested date is not checked or reserved automatically. The Supabase schema and Netlify availability endpoint are groundwork for future live scheduling and are not connected to the inquiry form. To enable live availability and conflict-safe booking:

1. Create a Supabase project and run [`supabase/schema.sql`](./supabase/schema.sql) in its SQL editor.
2. In Netlify site environment variables, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Keep the service-role key server-side; never put it in site HTML or public variables.
3. Deploy the site and wire the date/availability UI to the endpoint. The schedule uses Vancouver time, weekdays 7–10 p.m., weekends 10 a.m.–7 p.m., and start times spaced by the selected package duration plus a 10-minute break. It runs through November 30, 2026.

The database schema stores 15-minute pending-payment holds, expires them after 15 minutes, and prevents overlapping active bookings. Automatic scheduling and payment are separate future integrations; inquiries currently go to the studio by email. Stripe and Square use different APIs, so accepting deposits online requires a server-side adapter, provider secrets, webhook verification, and a confirmed-booking email flow. The package inquiry form does not charge clients.

Package photos are in `images/christmas-mini.jpg`, `images/christmas-standard-one-hour.jpg`, `images/christmas-standard-one-and-half-hours.jpg`, and `images/christmas-extended.jpg`.

## Updating portfolio galleries

Each portfolio card opens a lightbox gallery. To add a photo, put its image file in `images/` and add an entry to the matching list in the `galleryPhotos` object near the bottom of `index.html`. For example:

```js
portraits: [
  { src: "images/port1.jpg", alt: "Portrait on a sunlit city street" },
  { src: "images/portrait-session-2.jpg", alt: "Portrait beside a brick wall" }
]
```

Use descriptive alt text, and add the image file to GitHub with the code change so Netlify can publish it.

# ZakoStudio
# ZakoSudio
# ZakoSudio
# ZakoSudio
# ZakoSudio
# ZakoSudio
# ZakoStudio
