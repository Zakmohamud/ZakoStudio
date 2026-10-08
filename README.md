# ProjectXzylo
# ProjectXzylo
# ZakoStudio

## Booking inquiries

The booking form submits to the studio inbox through FormSubmit. On successful submission, clients return to the home page at `https://zako-studio.netlify.app/` and see a confirmation notice. FormSubmit also sends an automatic receipt email to the email address supplied in the form. This confirms inquiry receipt, not a reserved session.

The studio inbox must approve FormSubmit's one-time activation email before submissions are delivered. Keep FormSubmit's reCAPTCHA enabled; autoresponse emails are not supported for AJAX submissions or when reCAPTCHA is disabled.

## Christmas family-session bookings

Share the deposit and package details page in Instagram and Facebook ads: <https://zako-studio.netlify.app/christmas-booking.html>. The floating “Christmas family sessions” button on the portfolio opens this page. Its booking button continues to the Google Calendar schedule: <https://calendar.app.google/FtFvMFYHvD4LUwKb6>.

Packages: 30-minute Mini, $200 CAD, 5–10 edited images; 1-hour Standard, $350 CAD, 15–25 edited images; 1.5-hour Standard, $450 CAD, 15–25 edited images; and 2-hour Extended, $650 CAD, 30–50 edited images. A 50% deposit is invoiced after a client books; the session is confirmed once it is paid. Deposits are non-refundable, with one reschedule allowed with at least 48 hours’ notice.

The schedule is set to Vancouver time, with weekday availability from 7–10 p.m. and weekend availability from 10 a.m.–7 p.m., through November 30, 2026. Clients enter their preferred length in a required response. Google Calendar reserves a full two-hour block for every booking, including shorter sessions. The meeting location is confirmed after booking.

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
