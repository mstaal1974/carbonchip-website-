# Carbonchip — quote engine setup

## File placement

```
lib/schemas.ts                      → shared, imported by both app and functions
functions/src/schemas.ts            → copy or symlink of lib/schemas.ts
functions/src/submitQuote.ts        → callable + Firestore trigger
components/order/useQuoteForm.ts    → client hook
firestore.rules                     → project root
```

Keeping one schema across client and server is the point of this
setup — the client gets instant validation, the server re-validates
the same rules so nothing can be bypassed by posting directly to the
function. Either symlink `functions/src/schemas.ts` to `lib/schemas.ts`
or publish it as a small workspace package.

## Install

```bash
npm i zod react-hook-form @hookform/resolvers firebase
cd functions && npm i zod nodemailer firebase-admin firebase-functions
npm i -D @types/nodemailer
```

## Secrets

```bash
firebase functions:secrets:set SMTP_HOST
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
```

Any transactional provider works — SendGrid, Postmark, Mailgun,
or Google Workspace SMTP relay if the domain already sits there.

## TTL on rate limit docs

Rate limit documents carry an `expiresAt` field. Set a TTL policy so
they self-clean:

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=rateLimits --enable-ttl
```

## Deploy

```bash
firebase deploy --only firestore:rules,functions
```

## Before go-live

1. **Turn on App Check.** Set `enforceAppCheck: true` in `submitQuote`
   and register the site with reCAPTCHA Enterprise. Until then the
   honeypot and IP rate limit are the only bot defence.
2. **Verify the density figures** in `DENSITY`. They're reasonable
   industry approximations, but the m³ conversion shown to customers
   should match what actually comes off your weighbridge — moisture
   content moves wood chip a long way.
3. **Confirm the freight tier thresholds** against your real haulage
   contracts. The 8 / 25 / 60 tonne breakpoints are a sensible default,
   not your actual fleet.
4. **Check the `>75%` fixed carbon and `100% plantation-sourced` claims**
   against your certification before those numbers go on the homepage.
5. Consider a `quotedAt` / `quotedAmount` field on the record so the
   Firestore collection doubles as a lightweight CRM.
