# Kitty store: go-live checklist

*The code is finished and typecheck-clean. Everything below is on your side:
accounts, credentials and the one store only you can create. Work top to
bottom; each step says how you know it worked. Nothing here needs a developer.*

The technical reference (every field, every webhook, every edge case) lives in
`src/lib/commerce/README.md`. This file is the **ordered runbook**: what to do,
in what order, and when you are done. The 5 Oct session's log, with the same
steps in more detail, is `docs/HANDOVER-06-PRINTFUL.md`.

---

## What is already built (nothing to do here)

- **Stripe Checkout**: hosted payment page, wallets (Apple/Google Pay/Link)
  pick up automatically once enabled in the dashboard. Charges in GBP to keep
  you on Stripe's cheapest UK tier (1.5% + 20p). See `src/lib/commerce/stripe.ts`.
- **Print-on-demand**: **Printful** is the UK primary (Wolverhampton factory:
  embroidery + water-based DTG), **Printify** the fallback. The provider is
  chosen automatically from which env vars you set (`src/lib/commerce/pod/`).
  Printful orders are created as a draft and then confirmed; if confirm fails
  (no billing method yet) the draft is kept and you confirm it later.
- **The products, as Printful sees them**: every one of the ten variants is
  mapped to a Printful catalog variant (`src/config/printful.ts`; all in stock
  for the UK on 5 Oct 2026), with the three print files in `public/print/`.
  Orders work from the catalog **before any product exists in your store**.
  `node scripts/printful.mjs products sync` creates the store products from
  the same file when you want them.
- **The link between them**: a paid Stripe session drives the Printful order
  automatically (`processPaidSession` → `fulfil` → `pod.createOrder`), records
  every step in Supabase, and emails the customer. Money is taken before the
  provider is called, so a slow provider never blocks a sale.
- **The database**: the order tables are migration
  `supabase/migrations/20261005080000_commerce.sql`, already applied to the
  Kittyfive project and covered by the RLS smoke test.
- **The Orders card on `/admin`**: every order with its items, status, Printful
  id and tracking, and three buttons: Send to the maker, Confirm at Printful,
  Refresh from the maker. Connected services says exactly what is missing.
- **The operator CLI**: `node scripts/printful.mjs status | catalog |
  printfiles | products sync | webhooks | orders | selftest`. It reads
  `.env.local` and never prints the token.
- **Demo mode**: with no keys set, the whole store runs safely with a
  "DEMO: no real payments" banner. You are in demo mode right now.
- **The proof**: `npm run verify:commerce` runs the whole money path against
  mock Stripe, Supabase, Printful and Printify on this machine, with no keys,
  and passes (Step 6 starts with it).

**The gap between demo and live:** real credentials, plus one thing only you can
make: the Printful **store**. The token in `.env.local` is valid, but the account
has no store, and Printful cannot create one through the API. That is Step 3.

---

## Why this is worth doing (the fee answer, in one line)

Your £20 order that paid out £16.90 lost 15.5% to a **marketplace**, not Stripe.
The same £20 sold **direct through Kitty** nets **£19.50** — £2.60 more, every
order. Full working in `docs/FEES.md`.

---

## Step 1: Stripe account + test keys (~15 min)

- [ ] Create/sign in at [dashboard.stripe.com](https://dashboard.stripe.com).
- [ ] **Developers → API keys.** Copy the **test** secret key (`sk_test_…`).
- [ ] **Settings → Payment methods:** turn on Card, Apple Pay, Google Pay, Link.
- [ ] Put the test key in `.env.local` (create the file if needed):
      `STRIPE_SECRET_KEY=sk_test_…`
- [ ] `node scripts/stripe-selftest.mjs` prints PASS (it builds a test Checkout
      Session with Kitty's exact parameters; nothing is charged, and it refuses
      a live key).

> You will get the webhook secret in Step 6 (local) and Step 8 (production).
> **Done when:** the self-test passes on your `sk_test_…` key.

---

## Step 2: Supabase project + database (~10 min)

- [x] **Project:** Kittyfive (`xloturzrohswrmbqwylt`, eu-central-1) exists.
- [x] **Database:** the commerce tables are migration
      `supabase/migrations/20261005080000_commerce.sql`, already applied and
      recorded as version `20261005080000`. Nothing to paste.
      `node scripts/db.mjs supabase/tests/rls-smoke.sql` proves the row-level
      security (it rolls back).
- [ ] **Project Settings → API:** copy the **Project URL** and the
      **service_role** key (the secret one, *not* anon).
- [ ] Add to `.env.local`:
      ```
      NEXT_PUBLIC_SUPABASE_URL=https://xloturzrohswrmbqwylt.supabase.co
      SUPABASE_SERVICE_ROLE_KEY=…
      ```

> The `snacks_public` "security definer view" warning in Supabase is expected
> and intentional (documented in the migration).
> **Done when:** both values are in `.env.local`.

---

## Step 3: Printful store + billing (~15 min)

The account exists and its API token is already in `.env.local` as
`PRINTFUL_API_TOKEN` (never paste it anywhere else). What is missing is a store.

- [ ] Sign in at [printful.com](https://www.printful.com). **Stores → Connect
      via API** (Printful may call it "Manual order platform / API"). Give it
      any name.
- [ ] From the project root run `node scripts/printful.mjs status`. The line
      `stores on this token:` now shows your new store's id. Copy it.
- [ ] Add to `.env.local`: `PRINTFUL_STORE_ID=<that id>`
- [ ] **Billing → Billing methods:** add a card. Printful charges it for each
      order's base cost + shipping when the order is confirmed. Without a card
      every order stays a draft (nothing is lost; nothing is printed either).
- [ ] Run `node scripts/printful.mjs catalog`. It checks every variant against
      the live catalog and ends with `RESULT: PASS`.

> Prefer Printify instead? Set `PRINTIFY_API_TOKEN` + `PRINTIFY_SHOP_ID`, skip
> the Printful vars, and record the ids with `node scripts/pod-ids.mjs --write
> --map=…` (Printify has no catalog fallback). Do not set both.
> **Done when:** `node scripts/printful.mjs status` prints your store under
> `PRINTFUL_STORE_ID` with no "no store id yet", and `catalog` says PASS.

---

## Step 4: Print files deployed, products in your store (~15 min, mostly waiting)

Orders already work without this step (the catalog fallback). Do it anyway:
the store products carry the retail price and a thumbnail, and you see the
mockups in Printful.

- [ ] Commit `public/print/` (three PNGs, already generated) and
      `src/config/pod-ids.json` (the build imports it, so it must be in the
      repo even while it is still the empty placeholder), then push. Wait for
      the Vercel deploy. Open
      `https://kittyfive.vercel.app/print/kitty-face-embroidery.png`: Kitty's
      face on a transparent background. Printful fetches the print files from
      there, so this must be live before `products sync`.
- [ ] `node scripts/printful.mjs printfiles` prints the print-area sizes for
      the cap front, the hoodie's left chest, and the long-sleeve's back and
      sleeve. (Also note the `thread_colors*` option ids it lists for the cap;
      see Handover 06, open questions.)
- [ ] `node scripts/printful.mjs products sync --dry-run` prints the three
      request bodies and writes nothing. Read the variant lines.
- [ ] `node scripts/printful.mjs products sync` creates the three products and
      writes `src/config/pod-ids.json`. Run it again if you like: it updates
      in place with the same ids.
- [ ] Commit `src/config/pod-ids.json` again (now with the ten variants) and
      push.

> `NEXT_PUBLIC_SITE_URL` in `.env.local` must be `https://kittyfive.vercel.app`
> for this (Printful fetches the files from there).
> **Done when:** `node scripts/printful.mjs status` lists `kitty-cap`,
> `kitty-hoodie` and `kitty-longsleeve` as present, and `pod-ids.json` has ten
> variants.

---

## Step 5: Email (Resend), optional but recommended (~10 min)

- [ ] Create a key at [resend.com](https://resend.com) and verify your sending
      domain (`vercel.app` cannot be verified; this waits on a domain).
- [ ] Add to `.env.local`:
      ```
      RESEND_API_KEY=re_…
      EMAIL_FROM=Kitty <kitty@yourdomain>
      ```

> Without these, confirmation + shipped emails are logged to the server console
> instead of sent. Stripe can also send its own receipt (Settings → Emails).
> **Done when:** set, or consciously skipped for now.

---

## Step 6: Test the whole thing locally (~15 min)

`.env.local` already has `PRINTFUL_CONFIRM=0`, so the test order will be a
Printful **draft**: nothing is charged at Printful and nothing is made.

- [ ] First, with no keys needed at all: `npm run verify:commerce` must pass
      (it builds the site if needed, then runs the whole money path against
      mock Stripe, Supabase, Printful and Printify on this machine; results in
      `.verify/commerce-results.json`). If it fails, stop here: the code, not
      your accounts, needs looking at.
- [ ] Keep `NEXT_PUBLIC_SITE_URL=https://kittyfive.vercel.app` in `.env.local`
      (the print-file URLs in the order need it, and Step 4 put the files
      there). A request from localhost is still sent back to localhost, so you
      will land on `localhost:3200`, not the live site.
- [ ] In one terminal: `npm run dev -- -p 3200`
- [ ] In another, forward Stripe webhooks and copy the `whsec_…` it prints into
      `.env.local` as `STRIPE_WEBHOOK_SECRET`, then restart the dev server:
      ```sh
      stripe login
      stripe listen --forward-to localhost:3200/api/webhooks/stripe
      ```
- [ ] Open `http://localhost:3200/store`, press **Buy**, pay with test card
      `4242 4242 4242 4242` (any future date, any CVC, any UK postcode). You
      land back on `http://localhost:3200/checkout/success?session_id=…`.
- [ ] Sign in at `http://localhost:3200/account`, open `/admin` → Orders. The
      row shows `submitted`, `Printful #<id>` and the chip **draft: not
      confirmed** (the last event is `email_confirmation_skipped`, or `_sent`
      once Resend is set). If it says `paid`, read the order's events in
      Supabase: `pod_unmapped` usually means `NEXT_PUBLIC_SITE_URL` is not
      https.
- [ ] `node scripts/printful.mjs orders list --status=draft` shows the same id.
      Then `node scripts/printful.mjs orders cancel <id> --yes` so it is never
      produced.
- [ ] Sanity check: `curl -s localhost:3200/api/commerce/status`

> **Done when:** a test purchase creates a Supabase order *and* a Printful
> draft, and you have cancelled the draft. That proves Stripe → Printful end to
> end. This is the real acceptance test.

---

## Step 7: Put the same values in Vercel (~10 min)

Production today holds only `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Nothing else
was added by the 5 Oct session (its `vercel env add` was refused by the tool's
permission layer), so every name below is yours to add.

- [ ] **Vercel → kittyfive → Settings → Environment Variables.** Add, choosing
      **Preview** vs **Production** scope:
      ```
      STRIPE_SECRET_KEY            sk_test_… in Preview; sk_live_… in Production (Step 8)
      STRIPE_WEBHOOK_SECRET        Step 8
      SUPABASE_SERVICE_ROLE_KEY
      PRINTFUL_API_TOKEN           paste from .env.local; tick "Sensitive" so Vercel never shows it again
      PRINTFUL_STORE_ID
      PRINTFUL_WEBHOOK_SECRET      Step 8
      PRINTFUL_CONFIRM             0 to review every order as a draft first; 1 (or unset) to confirm automatically
      ```
- [ ] Check `NEXT_PUBLIC_SITE_URL` is `https://kittyfive.vercel.app` in both
      scopes (it builds the return URLs and the print-file URLs; http breaks
      catalog orders).
- [ ] Redeploy (Deployments → ⋯ → Redeploy) so the new values are picked up.

> **Done when:** signed in on the live site, `/admin` → Connected services says
> `Printful (the maker): connected` and the Print files line reads
> `10/10 blueprints · … store ids · site URL is https`.

---

## Step 8: Go live (~20 min)

- [ ] **Vercel Pro and Supabase Pro** before the first sale (Hobby forbids
      commercial use; Free pauses after a week idle).
- [ ] **Stripe → toggle to Live mode.** Copy the **live** secret key
      (`sk_live_…`) into Vercel **Production only**.
- [ ] **Stripe → Developers → Webhooks → Add endpoint:**
      `https://kittyfive.vercel.app/api/webhooks/stripe`, events
      `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `checkout.session.async_payment_failed`. Copy its signing secret into
      Vercel Production as `STRIPE_WEBHOOK_SECRET`.
- [ ] **Printful webhook** (so orders move to shipped and customers get
      tracking). Make a long random secret
      (`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`),
      put it in `.env.local` and Vercel Production as `PRINTFUL_WEBHOOK_SECRET`,
      then run `node scripts/printful.mjs webhooks register https://kittyfive.vercel.app`.
      It registers `…/api/webhooks/pod?secret=…` for nine event types.
      (Printful v1 webhooks are unsigned, so the secret rides in the URL; this
      is expected.) Redeploy.
- [ ] Decide `PRINTFUL_CONFIRM`. `0`: every order lands as a draft (the `/admin`
      row says **draft: not confirmed**) and you press **Confirm at Printful**
      there, or run `node scripts/printful.mjs orders confirm <id> --yes`,
      after a look; both charge the Printful card. `1`: confirmed and charged
      automatically.
- [ ] Do **one real low-value purchase** yourself on the live site, confirm the
      order appears on `/admin` and in Printful, then cancel it in Printful
      (`orders cancel <id> --yes` while it is a draft) and refund it in the
      Stripe dashboard.

> **Done when:** a real card purchase on your domain creates a live Printful
> order and `node scripts/printful.mjs webhooks list` shows the webhook. You are
> selling.

---

## After launch: worth knowing

- **`/admin` → Orders is the day-to-day view.** `paid` with no Printful id means
  the order never reached the maker (read `last:`): **Send to the maker** retries
  it. The chip **draft: not confirmed** means Printful has it but it has not
  been paid for: **Confirm at Printful**. The chip **fulfilment did not finish**
  means the payment webhook's follow-up work died: read `last:`, then Send to
  the maker. **Refresh from the maker** pulls status and tracking without
  waiting for the webhook (and sends the tracking email if that is when the
  order turns out to be shipped).
- **Keep prices in GBP.** Charging GBP to UK cards is Stripe's cheapest tier and
  avoids the 2% conversion fee. (`docs/FEES.md` has the full table.)
- **The £1 snack keeps ~78p**: the fixed 20p dominates at £1. If it gets
  popular, raise `SNACK.pricePence` or offer £1/£3/£5.
- **Costs per order** (Printful catalog, USD, 5 Oct 2026): cap 17.95; hoodie
  24.25 + 2.95 embroidery; long-sleeve 18.75 + 5.95 back + 5.95 sleeve; plus UK
  shipping. Kitty charges £28 / £55 / £38 + £3.99.
- **Refunds** are done in the Stripe dashboard; the local DB is not updated on
  refund (a known limit, listed in the README).
- **Traffic:** rate limits are in-memory per instance. If the site gets real
  volume, move them to Upstash/Vercel KV (`src/lib/rateLimit.ts`).

---

*Reference: `src/lib/commerce/README.md` (technical detail) · `docs/FEES.md`
(the fee analysis) · `docs/HANDOVER-06-PRINTFUL.md` (the 5 Oct session) ·
`scripts/printful.mjs` (the operator CLI used in Steps 3, 4, 6 and 8).*
