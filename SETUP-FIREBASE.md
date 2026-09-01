# Turning on the shared photo album

The app ships working. Until you do this, uploads run in **LOCAL mode** — they
persist in each person's own browser and are shared with nobody, and the PHOTOS
button says `PHOTOS · LOCAL` so it's obvious which mode you're in. Everything below
switches it to one album everyone sees.

You'll need to do this part yourself — I can't create accounts.

## 1. Make the project

1. <https://console.firebase.google.com> → **Add project**. You can attach it to the
   same Google account that holds the Maps API key.
2. Google Analytics is not needed — turn it off.

## 2. Turn on the three services

- **Build → Authentication → Get started → Anonymous → Enable.**
  This is what gives each device a stable id, which is what "delete only your own"
  keys on. Nobody makes an account or types an email.
- **Build → Firestore Database → Create database → Production mode.**
  If you give the database a **name** instead of taking the default, set
  `databaseId` in `firebase-config.js` to match (this project uses
  `chicagophotos`). The SDK talks to the one called `(default)` unless told
  otherwise, and the mismatch fails silently — reads come back empty from a local
  cache and writes sit in an offline queue, so photos just never appear.
- **Build → Storage → Get started → Production mode.**

Production mode starts locked down; step 4 opens exactly what's needed.

## 3. Paste the config

**Project settings** (gear, top-left) **→ General → Your apps → Web app** (`</>`).
Register the app, then copy the `firebaseConfig` values into `firebase-config.js`:

```js
firebase: {
  apiKey: 'AIza…',
  authDomain: 'chitown-xxxx.firebaseapp.com',
  projectId: 'chitown-xxxx',          // <- this is the switch
  storageBucket: 'chitown-xxxx.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:abc123'
}
```

Set `passcode` in the same file to whatever the four of you will type.

> The Firebase web config is **not** a secret — it ships in every Firebase web app
> and is safe in a public repo. Your security comes from the rules in step 4, not
> from hiding these values.

## 4. Publish the rules

This is the step that actually protects the album. Copy `firestore.rules` into
**Firestore → Rules** and `storage.rules` into **Storage → Rules**, then Publish.

Together they enforce: you must be signed in to write; a photo record must have the
exact expected shape; you cannot forge another device's id; and uploads must be WebP
under 4 MB and land under your own id's folder.

**Deleting is open to anyone with the trip code**, by design — the album is shared
property. Ownership was worse than useless here: anonymous ids are per-browser, so
anyone who cleared their site data lost the ability to remove their own photos, and
those photos became permanently stuck. Uploads are still stamped with the device
that made them, and that stamp still can't be forged.

## 5. Add your domain

**Authentication → Settings → Authorized domains → Add domain**, and add the Pages
host (e.g. `daleseepersadapps.github.io`). Anonymous sign-in is refused from
unlisted domains, so skipping this makes uploads fail silently in production while
working fine on localhost.

## 6. Deploy and check

Redeploy, open the app, tap **PHOTOS**. The button should read `PHOTOS` with no
`· LOCAL`. Add a photo on one phone and it should appear on another within a second
or two — the app subscribes to changes rather than polling.

---

## What the passcode does and does not do

It is a **UI latch**, not a security boundary. A static site has nowhere to keep a
secret, so anyone who reads the page source can find the code, and anyone who can
find it can sign in anonymously and write. It stops casual visitors who stumble on
the URL. It does not stop someone determined.

If that matters — say the link gets posted somewhere public — the fix is to move
uploads behind something that holds the secret server-side: a Cloud Function or a
Cloudflare Worker that checks the passcode and signs the upload. That's a contained
change; ask and I'll do it.

Two cheap mitigations in the meantime: keep the Pages URL unlisted, and set a
**budget alert** in Google Cloud Billing so a surprise can't run up a bill.

## Costs

The free (Spark) tier covers 1 GB stored, 10 GB/month downloaded, and 50k Firestore
reads/day. Uploads are re-encoded to WebP at 1400px — roughly 150–300 KB each — so
a few hundred trip photos sit well inside it. `maxPerDay` in `firebase-config.js`
caps a single day at 40 photos as a backstop.

## Turning it off

Blank out `projectId` and the app falls straight back to LOCAL mode. Nothing else
breaks — the trip plan, maps and curated photos don't depend on any of this.
