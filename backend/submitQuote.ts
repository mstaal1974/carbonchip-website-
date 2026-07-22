import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import nodemailer from 'nodemailer';

import {
  quoteRequestSchema,
  freightFor,
  toTonnes,
  toCubic,
  FREIGHT_LABELS,
  type QuoteRecord,
} from './schemas';

if (!getApps().length) initializeApp();
const db = getFirestore();

const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');

const SALES_INBOX = 'fletcher@carbonchip.com.au';
const SALES_CC = 'mickael@carbonchip.com.au';
const FROM = 'Carbonchip Website <no-reply@carbonchip.com.au>';

/* ------------------------------------------------------------------
   Rate limiting — one document per IP per hour window.
   Cheap, adequate for a B2B quote form. Swap for App Check in
   production if you want something stronger.
   ------------------------------------------------------------------ */
const MAX_PER_HOUR = 5;

async function checkRateLimit(ip: string): Promise<void> {
  const windowKey = `${ip}_${Math.floor(Date.now() / 3_600_000)}`;
  const ref = db.collection('rateLimits').doc(windowKey);

  const count = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data()?.count ?? 0) : 0;
    if (current >= MAX_PER_HOUR) return current;
    tx.set(
      ref,
      { count: current + 1, expiresAt: new Date(Date.now() + 7_200_000) },
      { merge: true }
    );
    return current + 1;
  });

  if (count > MAX_PER_HOUR) {
    throw new HttpsError(
      'resource-exhausted',
      'Too many requests. Call us on 0477 425 258 and we can take the details directly.'
    );
  }
}

/* Human-readable reference: CC-260722-4F2A */
function makeReference(): string {
  const d = new Date();
  const date = [
    String(d.getFullYear()).slice(2),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CC-${date}-${rand}`;
}

/* ==================================================================
   1. Callable — invoked from OrderCalculator.tsx
   ================================================================== */

export const submitQuote = onCall(
  {
    region: 'australia-southeast1',
    cors: ['https://carbonchip.com.au', 'https://www.carbonchip.com.au'],
    enforceAppCheck: false, // flip to true once App Check is configured
  },
  async (request) => {
    const ip = request.rawRequest.ip ?? 'unknown';
    await checkRateLimit(ip);

    // Validate server-side. Never trust the client's own validation.
    let data;
    try {
      data = quoteRequestSchema.parse(request.data);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new HttpsError('invalid-argument', 'Check the highlighted fields.', {
          fieldErrors: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    // Honeypot tripped — accept silently so bots don't learn.
    if (data.company_website) {
      return { reference: makeReference(), ok: true };
    }

    // Recompute derived values server-side.
    const tonnes = toTonnes(data.quantity, data.unit, data.product);
    const cubicMetres = toCubic(data.quantity, data.unit, data.product);
    const freight = freightFor(tonnes);
    const reference = makeReference();

    const record: Omit<QuoteRecord, 'createdAt'> & { createdAt: FieldValue } = {
      ...data,
      company_website: '',
      reference,
      tonnes: Math.round(tonnes * 10) / 10,
      cubicMetres: Math.round(cubicMetres * 10) / 10,
      freight,
      status: 'new',
      source: 'web',
      userAgent: String(request.rawRequest.headers['user-agent'] ?? '').slice(0, 300),
      createdAt: FieldValue.serverTimestamp(),
    };

    await db.collection('quoteRequests').doc(reference).set(record);

    // Email is sent by the trigger below, so a mail failure never
    // costs you the lead.
    return { reference, ok: true, freight: FREIGHT_LABELS[freight].name };
  }
);

/* ==================================================================
   2. Firestore trigger — notifications
   ================================================================== */

const PRODUCT_NAMES: Record<string, string> = {
  'wood-chip': 'Wood chip',
  microchip: 'Microchip',
  mulch: 'Forest mulch',
  furnace: 'Furnace biomass',
  logs: 'Logs',
  biochar: 'Biochar',
};

export const onQuoteCreated = onDocumentCreated(
  {
    document: 'quoteRequests/{reference}',
    region: 'australia-southeast1',
    secrets: [SMTP_HOST, SMTP_USER, SMTP_PASS],
  },
  async (event) => {
    const q = event.data?.data() as QuoteRecord | undefined;
    if (!q) return;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST.value(),
      port: 587,
      secure: false,
      auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() },
    });

    const productName = PRODUCT_NAMES[q.product] ?? q.product;
    const haulage = FREIGHT_LABELS[q.freight];

    /* --- Internal notification --- */
    const internal = `
New quote request — ${q.reference}

PRODUCT     ${productName}
VOLUME      ${q.tonnes} tonnes (${q.cubicMetres} m³)
HAULAGE     ${haulage.name}
            ${haulage.note}

CONTACT     ${q.name}
EMAIL       ${q.email}
PHONE       ${q.phone}
POSTCODE    ${q.postcode}

NOTES
${q.notes || '— none —'}

Console: https://console.firebase.google.com/project/_/firestore/data/quoteRequests/${q.reference}
`.trim();

    await transporter.sendMail({
      from: FROM,
      to: SALES_INBOX,
      cc: SALES_CC,
      replyTo: `${q.name} <${q.email}>`,
      subject: `Quote ${q.reference} — ${q.tonnes}t ${productName} to ${q.postcode}`,
      text: internal,
    });

    /* --- Customer acknowledgement --- */
    const ack = `
Hi ${q.name.split(' ')[0]},

Thanks for your enquiry. We've logged it as ${q.reference}.

  Product     ${productName}
  Volume      ${q.tonnes} tonnes (approx. ${q.cubicMetres} m³)
  Delivery    Postcode ${q.postcode}
  Haulage     ${haulage.name}

We'll confirm availability and come back with a delivered rate within
one business day. If it's urgent, call Mickael on 0477 425 258.

Carbonchip Australia
Suite 1 / Level 1, 9 Gardner Close, Milton QLD 4064
carbonchip.com.au
`.trim();

    await transporter.sendMail({
      from: FROM,
      to: q.email,
      replyTo: SALES_INBOX,
      subject: `Carbonchip quote request ${q.reference}`,
      text: ack,
    });
  }
);
