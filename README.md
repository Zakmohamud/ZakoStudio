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

The Christmas page accepts email inquiries through FormSubmit. Listed times use fixed 45-minute starts (10:00, 10:45, 11:30, and so on on weekends); a session is offered only when it fits the daily hours and does not overlap a confirmed booking. A custom time is sent as a request for the photographer to review. Inquiries do not reserve a time, so availability is not held while someone submits the form.

To enable live availability and the private booking manager:

1. Create a Supabase project and run [`supabase/schema.sql`](./supabase/schema.sql) in its SQL editor. If the project already has the earlier booking schema, rerun the updated script to add the admin booking function and replace the available-time function.
2. In Netlify environment variables, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `CHRISTMAS_ADMIN_EMAIL`. `CHRISTMAS_ADMIN_EMAIL` must be the email of the Supabase Auth user you create for the studio administrator. Keep the service-role key server-side; never put it in site HTML or public variables.
3. Create and confirm that administrator user in Supabase Auth, then use its email and password to sign in at `/christmas-admin.html`. The page lists upcoming confirmed sessions and lets the administrator add or cancel sessions. The server checks overlaps again when adding a session.
4. Deploy the site. The schedule uses Vancouver time, weekdays 7–10 p.m., weekends 10 a.m.–7 p.m., and runs through November 30, 2026.

After confirming an inquiry with a client, add it in the private manager so overlapping listed times disappear. Since inquiries are not holds, two clients could request the same time before either is confirmed; the manager prevents both from being recorded as confirmed. The 50% deposit is arranged by email and the inquiry form does not charge clients.

The database also supports 15-minute pending-payment holds for a future online payment integration. Stripe and Square require a server-side adapter, provider secrets, webhook verification, and a confirmed-booking email flow before deposits can be charged online.

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
