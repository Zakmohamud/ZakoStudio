# ProjectXzylo
# ProjectXzylo
# ZakoStudio

## Booking inquiries

The portfolio inquiry form submits to the studio inbox through FormSubmit. Christmas package inquiries are emailed directly to `zakotarastudio@gmail.com`, include the selected package and requested date/time, and return to the package page after submission. Christmas inquiries do not send an automatic reply to the client. An inquiry is not a reserved session.

The studio inbox must approve FormSubmit's one-time activation email before submissions are delivered. FormSubmit's reCAPTCHA is disabled on the Christmas form (see below); keep it on for the portfolio form.

## Christmas family-session bookings

Share the Christmas package page in Instagram and Facebook ads: <https://zako-studio.netlify.app/christmas-booking.html>. The floating “Christmas family sessions” button on the portfolio opens this page. Each package has its own detail URL through a `package` query parameter.

Packages: 15-minute Quick, $175 CAD, 10+ edited images, up to 3 people; 30-minute Mini, $300 CAD, 20+ edited images, up to 5 people; and 1-hour Extended, $600 CAD, 40+ edited images, up to 7 people. A 50% deposit is required before a booking is confirmed; its amount is explained at the end of the inquiry form. The photographer follows up by email to confirm availability and arrange the deposit. Submitting an inquiry does not reserve a date or charge the client.

### Booking-system setup

The Christmas page accepts email inquiries through FormSubmit. Listed times use fixed 45-minute starts (10:00, 10:45, 11:30, and so on on weekends); a session is offered only when it fits the daily hours and does not overlap a confirmed booking. A custom time is sent as a request for the photographer to review. Inquiries do not reserve a time, so availability is not held while someone submits the form.

To enable live availability and the private booking manager:

1. Create a Supabase project and run [`supabase/schema.sql`](./supabase/schema.sql) in its SQL editor. If the project already has the earlier booking schema, rerun the updated script to add the admin booking function and replace the available-time function.
2. In Netlify environment variables, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `CHRISTMAS_ADMIN_EMAIL`. `CHRISTMAS_ADMIN_EMAIL` must be the email of the Supabase Auth user you create for the studio administrator. Keep the service-role key server-side; never put it in site HTML or public variables.
3. Create and confirm that administrator user in Supabase Auth, then use its email and password to sign in at `/christmas-admin.html`. The page lists upcoming confirmed sessions, lets the administrator add or cancel sessions, and can send a password-reset email to the configured studio admin address. The server checks overlaps again when adding a session.
4. Deploy the site. The schedule uses Vancouver time, weekdays 7–10 p.m., weekends 10 a.m.–7 p.m., and runs through November 30, 2026.

After confirming an inquiry with a client, add it in the private manager so overlapping listed times disappear. Since inquiries are not holds, two clients could request the same time before either is confirmed; the manager prevents both from being recorded as confirmed. The 50% deposit is arranged by email and the inquiry form does not charge clients.

The database also supports 15-minute pending-payment holds for a future online payment integration. Stripe and Square require a server-side adapter, provider secrets, webhook verification, and a confirmed-booking email flow before deposits can be charged online.

Package photos are in `images/christmas-extended.jpg` (Mini) and `images/christmas-standard-one-hour.jpg` (Extended).

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

## Referral and discount codes

Partners get their own code (for example `SARAH15`). Anyone who enters it on the Christmas booking page sees the discounted price and deposit right away, and the inquiry email shows the code, discount, and final price.

- Manage codes at `/referral-admin.html`: create a code, set its % off (1–90), add an optional expiry date, turn it on/off, or delete it. Changes take effect immediately — no redeploy.
- The same page lists every inquiry sent from the booking page, with the code/partner and "How did you hear about me?" answer. Tick **Booked** when a client confirms to see each partner's booked count.
- The page is protected by the `REFERRAL_ADMIN_PASSWORD` environment variable in Netlify (Site configuration → Environment variables). Mark it as a secret and give it the Functions scope.
- Codes and inquiries are stored in Netlify Blobs (stores `referral-codes` and `referral-inquiries`). Codes are checked server-side, so the list is never visible in the page source.

## Bookings, blocking, and the schedule

The Christmas booking page offers weekends (morning 8 a.m.–12 p.m., afternoon 12–5 p.m.) and Wednesday/Friday evenings (4–7 p.m.). After choosing a part of the day, clients pick an exact start time from a list that only shows open times; "Flexible" is always available. Other weekdays can be requested for after 7 p.m.

Manage everything at `/referral-admin.html` ("Bookings & codes"):

- **Mark booked**: each inquiry has a date and start time (pre-filled from the client's choice). Clicking *Mark booked* blocks that session's length plus a 10-minute break on the booking page. The server refuses overlaps. *Undo* opens the time again.
- **Block off time**: block a time range or a whole day (holidays, phone bookings).
- **Upcoming schedule**: every booked session and block, grouped by day.

Hours, the break length, and the season end date are set near the top of the `<script>` in `christmas-booking.html` (`DAY_PARTS`, `BREAK_MINUTES`, `SEASON_END`); the server's break length is `BREAK_MINUTES` in `netlify/lib/referrals.mjs`. Schedule entries live in the Netlify Blobs store `booking-schedule`.

The booking page no longer uses Supabase. The older `/christmas-admin.html` manager is superseded by this page.

FormSubmit's verification page is turned off on the Christmas form (`_captcha=false`); the hidden honeypot field still filters most spam bots.
