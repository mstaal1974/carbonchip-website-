# Carbonchip website

Landing site for **Carbonchip Australia** — plantation timber residue graded into
six renewable biomass products (wood chip, microchip, forest mulch, furnace
biomass, logs, biochar) and delivered across Australia.

The homepage reproduces the "From forest waste to renewable biomass" design:
a full-bleed forest/conveyor hero with tappable floating product pills, a stats
band, a product grid, a process explainer, a sustainability section, an
interactive quote form, and the contact footer.

## Structure

```
index.html          Single-file landing page (inline styles + vanilla JS, no build step)
assets/             Hero, process, furnace and product imagery
backend/            Optional quote-engine (Firebase Functions + Firestore) — see backend/SETUP.md
```

## Run locally

It's a static site — open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Interactivity

- **Hero pills / product cards** open a product detail modal.
- Choosing a product (in the modal or a card's "Get a quote") pre-selects it in
  the order form.
- The order form validates and confirms client-side. It is **not** wired to a
  backend by default.

## Wiring the quote form to a backend (optional)

`backend/` contains a production-ready quote engine: a shared Zod schema
(`schemas.ts`), a Firebase callable + Firestore trigger that re-validates and
emails the quote (`submitQuote.ts`), a client hook (`useQuoteForm.ts`), and
Firestore security rules. Follow `backend/SETUP.md` for placement, secrets and
deploy. Before go-live, verify the density figures, freight thresholds and the
`>75%` / `100% plantation-sourced` claims noted in that file.
