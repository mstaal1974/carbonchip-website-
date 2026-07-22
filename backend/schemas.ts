import { z } from 'zod';

/* ------------------------------------------------------------------
   Product identifiers — single source of truth.
   Keep in sync with lib/products.ts.
   ------------------------------------------------------------------ */
export const PRODUCT_IDS = [
  'wood-chip',
  'microchip',
  'mulch',
  'furnace',
  'logs',
  'biochar',
] as const;

export type ProductId = (typeof PRODUCT_IDS)[number];

export const UNITS = ['tonnes', 'm3'] as const;
export type Unit = (typeof UNITS)[number];

/* Bulk density, tonnes per m³. Used for unit conversion on both
   client and server so the two can never disagree. */
export const DENSITY: Record<ProductId, number> = {
  'wood-chip': 0.32,
  microchip: 0.30,
  mulch: 0.28,
  furnace: 0.35,
  logs: 0.65,
  biochar: 0.22,
};

/* ------------------------------------------------------------------
   Freight tiers — server-authoritative.
   The client shows a suggestion; the server recomputes it so the
   stored record can't be tampered with via the request body.
   ------------------------------------------------------------------ */
export const FREIGHT_OPTIONS = [
  'bulk-bag',
  'single-tipper',
  'truck-and-dog',
  'walking-floor',
] as const;

export type FreightOption = (typeof FREIGHT_OPTIONS)[number];

export const FREIGHT_LABELS: Record<FreightOption, { name: string; note: string }> = {
  'bulk-bag': {
    name: 'Bulk bag / ute load',
    note: 'Palletised or loose, delivered by tray truck.',
  },
  'single-tipper': {
    name: 'Single tipper',
    note: 'Tipping site access required.',
  },
  'truck-and-dog': {
    name: 'Truck and dog',
    note: 'Suits most regional depot deliveries.',
  },
  'walking-floor': {
    name: 'Walking floor / B-double',
    note: 'Hardstand and turning circle required on site.',
  },
};

export function freightFor(tonnes: number): FreightOption {
  if (tonnes < 8) return 'bulk-bag';
  if (tonnes < 25) return 'single-tipper';
  if (tonnes < 60) return 'truck-and-dog';
  return 'walking-floor';
}

export function toTonnes(qty: number, unit: Unit, product: ProductId): number {
  return unit === 'tonnes' ? qty : qty * DENSITY[product];
}

export function toCubic(qty: number, unit: Unit, product: ProductId): number {
  return unit === 'm3' ? qty : qty / DENSITY[product];
}

/* ------------------------------------------------------------------
   AU phone: accepts 04xx xxx xxx, 0x xxxx xxxx, +61 forms, and
   1300/1800 numbers. Strips separators before testing.
   ------------------------------------------------------------------ */
const AU_PHONE = /^(?:\+?61|0)[2-478](?:\d{8})$|^(?:1300|1800)\d{6}$/;

export const quoteRequestSchema = z
  .object({
    product: z.enum(PRODUCT_IDS, {
      errorMap: () => ({ message: 'Select a product.' }),
    }),

    unit: z.enum(UNITS),

    quantity: z
      .number({ invalid_type_error: 'Enter a volume.' })
      .positive('Volume must be greater than zero.')
      .max(2000, 'For volumes above this, call us directly on 0477 425 258.'),

    name: z
      .string()
      .trim()
      .min(2, 'Enter a name or company.')
      .max(120, 'Keep this under 120 characters.'),

    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Enter a valid email address.')
      .max(200),

    phone: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s()\-.]/g, ''))
      .refine((v) => AU_PHONE.test(v), 'Enter a valid Australian phone number.'),

    postcode: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'Enter a 4-digit postcode.'),

    notes: z
      .string()
      .trim()
      .max(2000, 'Keep notes under 2000 characters.')
      .optional()
      .default(''),

    /* Honeypot — must stay empty. Rendered off-screen, not
       visually hidden, so screen readers skip it via aria-hidden. */
    company_website: z.string().max(0).optional().default(''),
  })
  .superRefine((val, ctx) => {
    // Guard against absurd conversions, e.g. 2000 m³ of logs.
    const tonnes = toTonnes(val.quantity, val.unit, val.product);
    if (tonnes > 1500) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantity'],
        message: 'That works out over 1500 tonnes. Call us to discuss a supply agreement.',
      });
    }
  });

export type QuoteRequestInput = z.input<typeof quoteRequestSchema>;
export type QuoteRequest = z.output<typeof quoteRequestSchema>;

/* Shape actually written to Firestore. */
export interface QuoteRecord extends QuoteRequest {
  reference: string;
  tonnes: number;
  cubicMetres: number;
  freight: FreightOption;
  status: 'new' | 'quoted' | 'won' | 'lost';
  createdAt: FirebaseFirestore.Timestamp | Date;
  source: 'web';
  userAgent?: string;
}
