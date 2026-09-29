# Kitty store — go-live checklist

*The code is finished and typecheck-clean. Everything below is on your side:
accounts, credentials and the product ids only you can create. Work top to
bottom; each step says how you know it worked. Nothing here needs a developer.*

The technical reference (every field, every webhook, every edge case) lives in
`src/lib/commerce/README.md`. This file is the **ordered runbook** — what to do,
in what order, and when you're done.

---

## What is already built (nothing to do here)

- **Stripe Checkout** — hosted payment page, wallets (Apple/Google Pay/Link)
  pick up automatically once enabled in the dashboard. Charges in GBP to keep
  you on Stripe's cheapest UK tier (1.5% + 20p). See `src/lib/commerce/stripe.ts`.
- **Print-on-demand** — **Printful** is the UK primary (Wolverhampton factory:
  embroidery + water-based DTG), **Printify** the fallback. The provider is
  chosen automatically from which env vars you set (`src/lib/commerce/pod/`).
- **The link between them** — a paid Stripe session drives the POD order
  automatically (`processPaidSession` → `fulfil` → `pod.createOrder`), records
  every step in Supabase, and emails the customer. Money is taken before the
  provider is called, so a slow provider never blocks a sale.
- **Demo mode** — with no keys set, the whole store runs safely with a
  "DEMO: no real payments" banner. You are in demo mode right now.

**The one gap between demo and live:** real credentials, plus the
`podProductId` / `podVariantId` for each variant in `src/config/products.ts`.
That's what the steps below fill in.

---

## Why this is worth doing (the fee answer, in one line)

Your £20 order that paid out £16.90 lost 15.5% to a **marketplace**, not Stripe.
The same £20 sold **direct through Kitty** nets **£19.50** — £2.60 more, every
order. Full working in `docs/FEES.md`.

---

## Step 1 — Stripe account + test keys  (~15 min)

- [ ] Create/sign in at [dashboard.stripe.com](https://dashboard.stripe.com).
- [ ] **Developers → API keys.** Copy the **test** secret key (`sk_test_…`).
- [ ] **Settings → Payment methods:** turn on Card, Apple Pay, Google Pay, Link.
- [ ] Put the test key in `.env.local` (create the file if needed):
      `STRIPE_SECRET_KEY=sk_test_…`

> You'll get the webhook secret in Step 6 (local) and Step 8 (production).
> **Done when:** you have `sk_test_…` saved locally.

---

## Step 2 — Supabase project + database  (~15 min)

- [ ] Create a project at [supabase.com](https://supabase.com).
- [ ] **Project Settings → API:** copy the **Project URL** and the
      **service_role** key (the secret one, *not* anon).
- [ ] **SQL Editor:** paste and run the contents of `supabase/commerce.sql`.
      It creates the `orders`, `order_items`, `order_events` tables.
- [ ] Add to `.env.local`:
      ```
      NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
      SUPABASE_SERVICE_ROLE_KEY=…
      ```

> The `snacks_public` "security definer view" warning in Supabase is expected
> and intentional (documented in the SQL).
> **Done when:** the three tables exist and both values are in `.env.local`.

---

## Step 3 — Printful account + your three products  (~30–45 min)

- [ ] Create/sign in at [printful.com](https://www.printful.com).
- [ ] Build the three products with your artwork attached:
      **embroidered cap**, **embroidered hoodie**, **DTG long-sleeve**.
      (Match the sizes/colours in `src/config/products.ts`.) Publishing to a
      sales channel is **not** required — API orders work without it.
- [ ] **Settings → API → Add token** (store-scoped). Copy the token and note the
      **store id** it's scoped to.
- [ ] Add to `.env.local`:
      ```
      PRINTFUL_API_TOKEN=…
      PRINTFUL_STORE_ID=…
      ```

> Prefer Printify instead? Set `PRINTIFY_API_TOKEN` + `PRINTIFY_SHOP_ID` and skip
> the Printful vars — the code picks whichever is set. Don't set both.
> **Done when:** all three products exist in Printful and the token + store id
> are in `.env.local`.

---

## Step 4 — Fetch the ids and paste them in  (~10 min)

This is the step that turns a *paid* order into a *fulfilled* one.

- [ ] From the project root, run:
      ```sh
      node scripts/pod-ids.mjs
      ```
      (It reads the token from `.env.local` automatically.) It prints every
      product's `podProductId` and every variant's `podVariantId`, plus a
      ready-to-paste snippet.
- [ ] Open `src/config/products.ts` and add `podProductId` + `podVariantId` to
      each variant, matching by size/colour. Example:
      ```ts
      { id: "hoodie-black-m", label: "Black / M", colour: "#111111", size: "M",
        podProductId: "…", podVariantId: 12345 },
      ```

> **A variant missing either id is never sent to the provider** — the order is
> recorded, left at status `paid`, and you'd fulfil it by hand. Fill every one.
> **Done when:** every variant in `products.ts` has both ids.

---

## Step 5 — Email (Resend) — optional but recommended  (~10 min)

- [ ] Create a key at [resend.com](https://resend.com) and verify your sending
      domain.
- [ ] Add to `.env.local`:
      ```
      RESEND_API_KEY=re_…
      EMAIL_FROM=Kitty <kitty@yourdomain>
      ```

> Without these, confirmation + shipped emails are logged to the server console
> instead of sent. Stripe can also send its own receipt (Settings → Emails).
> **Done when:** set, or consciously skipped for now.

---

## Step 6 — Test the whole thing locally  (~15 min)

- [ ] In one terminal: `npm run dev`
- [ ] In another, forward Stripe webhooks and copy the `whsec_…` it prints into
      `.env.local` as `STRIPE_WEBHOOK_SECRET`, then restart `npm run dev`:
      ```sh
      stripe login
      stripe listen --forward-to localhost:3000/api/webhooks/stripe
      ```
      (Use whatever port `next dev` actually reports.)
- [ ] Open `/store`, press **Buy**, pay with test card `4242 4242 4242 4242`
      (any future date, any CVC, any UK postcode).
- [ ] Confirm in Supabase: a row in `orders`, its `order_items`, and an
      `order_events` trail ending in fulfilment. Check Printful for a **draft/
      pending** order (it's a test — cancel it there so it isn't produced).
- [ ] Sanity check: `curl -s localhost:3000/api/commerce/status | jq`

> **Done when:** a test purchase creates a Supabase order *and* a Printful order.
> That proves Stripe → POD end to end. This is the real acceptance test.

---

## Step 7 — Put the same values in Vercel  (~10 min)

- [ ] **Vercel → your project → Settings → Environment Variables.** Add every
      key from `.env.local`, choosing **Preview** vs **Production** scope:
  - Preview: keep the **test** Stripe key (`sk_test_…`).
  - Production: use the **live** Stripe key (`sk_live_…`) — Step 8.
- [ ] Also set `NEXT_PUBLIC_SITE_URL` to your real domain (used for return URLs
      and product image URLs).

> **Done when:** Preview and Production both have their full set of vars.

---

## Step 8 — Go live  (~15 min)

- [ ] **Stripe → toggle to Live mode.** Copy the **live** secret key
      (`sk_live_…`) into Vercel **Production only**.
- [ ] **Stripe → Developers → Webhooks → Add endpoint:**
      `https://<your-domain>/api/webhooks/stripe`, events
      `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `checkout.session.async_payment_failed`. Copy its signing secret into
      Vercel Production as `STRIPE_WEBHOOK_SECRET`.
- [ ] **Printful webhook** (so customers get tracking): register
      `https://<your-domain>/api/webhooks/pod?secret=<PRINTFUL_WEBHOOK_SECRET>`
      for types `package_shipped`, `order_canceled`, `order_failed`,
      `order_updated`. Set the same `PRINTFUL_WEBHOOK_SECRET` in Vercel.
      (Printful v1 webhooks are unsigned, so the secret rides in the URL — this
      is expected.)
- [ ] Do **one real low-value purchase** yourself on the live site, confirm the
      order flows to Printful, then refund it in the Stripe dashboard.

> **Done when:** a real card purchase on your domain creates a live Printful
> order. You are selling.

---

## After launch — worth knowing

- **Keep prices in GBP.** Charging GBP to UK cards is Stripe's cheapest tier and
  avoids the 2% conversion fee. (`docs/FEES.md` has the full table.)
- **The £1 snack keeps ~78p** — the fixed 20p dominates at £1. If it gets
  popular, raise `SNACK.pricePence` or offer £1/£3/£5.
- **Refunds** are done in the Stripe dashboard; the local DB isn't updated on
  refund (a known limit, listed in the README).
- **Traffic:** rate limits are in-memory per instance. If the site gets real
  volume, move them to Upstash/Vercel KV (`src/lib/rateLimit.ts`).

---

*Reference: `src/lib/commerce/README.md` (technical detail) · `docs/FEES.md`
(the fee analysis) · `scripts/pod-ids.mjs` (the id fetcher used in Step 4).*
