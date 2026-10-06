# ProjectXzylo
# ProjectXzylo
# ZakoStudio

## Booking inquiries

The booking form submits to the studio inbox through FormSubmit. On successful submission, clients return to the home page at `https://zako-studio.netlify.app/` and see a confirmation notice. FormSubmit also sends an automatic receipt email to the email address supplied in the form. This confirms inquiry receipt, not a reserved session.

The studio inbox must approve FormSubmit's one-time activation email before submissions are delivered. Keep FormSubmit's reCAPTCHA enabled; autoresponse emails are not supported for AJAX submissions or when reCAPTCHA is disabled.

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
