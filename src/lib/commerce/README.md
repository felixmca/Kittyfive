# Kitty commerce — how to go live

Real money only. There is no play economy. With **no env vars** everything runs in
DEMO mode: checkout redirects straight to `/checkout/success?demo=1`, the webhook
returns `{ received: true, demo: true }`, and `DemoBanner` shows
**DEMO: no real payments** on every page that renders it.

Live mode switches on automatically when all four of these are present:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`. A print provider (Printful, the UK primary, or
Printify) and Resend are optional extras.

Check what the server thinks at any time: `GET /api/commerce/status`
(booleans only, never secrets; in demo mode it also runs `selfcheck.ts`).
Signed in as an admin, `/admin` shows the same facts in words (Connected
services) plus the Orders card (section 4c).

## Files

| File | Role |
|---|---|
| `types.ts` | `Commerce` interface, `CommerceError`, `validateQuantity`, `OrderStatus` |
| `env.ts` | reads env, `isLive()`, `hasPrintful()` / `hasPrintify()` / `hasPod()`, `isDeployed()`, `harnessOverridesPresent()` (the harness base URLs are honoured in production only when they point at localhost) |
| `index.ts` | `getCommerce()`: live if `isLive()` else demo; `status()` |
| `stripe.ts` | live implementation (Checkout Sessions, webhook, deferred fulfilment + email; the last update sets `processed_at` and re-asserts the provider id) |
| `demo.ts` | in-memory implementation |
| `orders.ts` | Supabase reads and writes: idempotent insert, status updates, append-only events, admin list with `needsConfirm` |
| `fulfilment.ts` | `fulfil(order, items, { force? })`: paid merch order → provider order; claims the row first, never throws, every outcome is an event |
| `supabaseAdmin.ts` | service-role client, server-only (throws if imported in a browser) |
| `pod/types.ts` | provider contract (`PodProvider`), `mapItemsToPod()` (the id resolution order), `toPodAddress()` |
| `pod/index.ts` | `getPod()`: Printful if its pair is set, else Printify if its pair is set, else demo |
| `pod/printful.ts` | print-on-demand adapter, **Printful, the UK primary** (API v1: draft, confirm, read back, webhook) |
| `pod/printify.ts` | print-on-demand adapter, Printify, the fallback |
| `pod/demo.ts` | print-on-demand adapter, demo (used when no provider pair is configured) |
| `email.ts` | Resend if configured, else `console.log` |
| `selfcheck.ts` | config invariants for `/api/commerce/status` (products, blueprints, pod ids, env pairs) |
| `origin.ts`, `format.ts` | helpers |
| `src/config/products.ts` | the three products, prices in pence, optional hand-written `podProductId` / `podVariantId` |
| `src/config/printful.ts` | the Printful **blueprints**: catalog product and variant ids, placements, print files, thread colours |
| `src/config/pod-ids.ts` + `pod-ids.json` | **generated** store ids (sync product / sync variant per variant), with the provider and store they belong to |
| `scripts/printful.mjs` | the Printful operator CLI (`npm run printful -- <command>`): status, catalog, printfiles, products sync, webhooks, orders, selftest |
| `scripts/print-files.mjs` | writes and checks the three print files in `public/print/` (`npm run print-files`) |
| `scripts/pod-ids.mjs` | lists a provider's store ids; `--write` records them in `pod-ids.json` (the Printify path) |
| `scripts/stripe-selftest.mjs` | proves a Stripe **test** key builds Kitty's Checkout Session; refuses a live key |
| `scripts/verify-commerce.mjs` + `scripts/commerce-mocks.mjs` | the commerce harness (`npm run verify:commerce`, section 7): mock Stripe, Supabase, Printful and Printify on 127.0.0.1 driving the production build |
| `supabase/migrations/20261005080000_commerce.sql` | `orders`, `order_items`, `order_events`, `snacks_public` (applied to Kittyfive on 5 Oct 2026) |

Routes: `POST /api/checkout`, `POST /api/snack`, `POST /api/webhooks/stripe`,
`POST /api/webhooks/pod`, `GET /api/commerce/status`, and for admins
`GET /api/admin/orders`, `POST /api/admin/orders/{id}`, `GET /api/admin/status`.
Page: `/checkout/success` (its `failed` label reads "Something went wrong with
this order. We will be in touch.", because a provider failure after payment is
not a payment failure). Components: `components/commerce/DemoBanner.tsx`,
`components/commerce/SnackButton.tsx`, `components/admin/Orders.tsx`.

## 1. Stripe

1. Dashboard → Developers → API keys. Use `sk_test_…` locally and in Preview,
   `sk_live_…` in Vercel **Production only**.
2. Enable Apple Pay / Google Pay / Link under Settings → Payment methods. Nothing
   in code changes: Checkout picks up dashboard-enabled wallets.
3. **Apple Pay domain verification**: not needed for hosted Stripe Checkout — the
   payment page is on `checkout.stripe.com`, which Stripe has already verified.
   You only need to register your domain (Settings → Payment method domains)
   if you later move to the embedded Payment Element on your own domain.
4. Local webhooks:

   ```sh
   stripe login
   stripe listen --forward-to localhost:3200/api/webhooks/stripe
   ```

   Copy the `whsec_…` it prints into `.env.local` as `STRIPE_WEBHOOK_SECRET`.
   (Use whatever port `next dev` is actually on; 3200 is the one this project
   uses. The harnesses have their own: 3201 for `scripts/verify.mjs`, 3202 and
   3203 for `scripts/verify-commerce.mjs`.)
5. Production webhook: Developers → Webhooks → Add endpoint →
   `https://<your-domain>/api/webhooks/stripe`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`. Copy its signing secret into Vercel.
6. Test cards: `4242 4242 4242 4242`, any future date, any CVC, any UK postcode.
   `node scripts/stripe-selftest.mjs` proves the test key and the session
   parameters without a browser.

The webhook reads `await req.text()` and verifies with
`stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)`.
Bad signature → 400. Handled or duplicate → 200. Unexpected failure → 500 so
Stripe retries. Print-provider failures are logged to `order_events` and still
return 200 (the money is already taken; the owner fulfils by hand).

## 2. Supabase

1. Create a project. Copy the URL to `NEXT_PUBLIC_SUPABASE_URL` and the
   **service_role** key to `SUPABASE_SERVICE_ROLE_KEY` (server-only, never
   `NEXT_PUBLIC_`).
2. The tables are migration `supabase/migrations/20261005080000_commerce.sql`,
   applied with the others (`node scripts/db.mjs <file>` locally, `supabase db
   push` with the CLI; already applied to Kittyfive and recorded as version
   `20261005080000`). It creates `orders`, `order_items`, `order_events`,
   enables RLS with **no policies**, and creates the `snacks_public` view
   (count + last snack time) for a public counter. `supabase/commerce.sql` is
   now only a pointer to it.
3. Nothing in the browser ever reads or writes these tables. The Supabase
   advisor will flag `snacks_public` as a "security definer view": that is
   intentional and documented in the SQL. `node scripts/db.mjs
   supabase/tests/rls-smoke.sql` proves anon and signed-in users can neither
   read nor write the three tables (it rolls back).

## 3. Vercel env

Settings → Environment Variables. Production and Preview separately. Every
name below is read in `env.ts`:

```
NEXT_PUBLIC_SITE_URL=https://kitty.example          # Stripe return URLs, product images, and the /print files Printful fetches: MUST be https
STRIPE_SECRET_KEY=sk_live_…                          # sk_test_… in Preview
STRIPE_WEBHOOK_SECRET=whsec_…                        # one per endpoint
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=…
# Print provider: set EITHER the Printful pair (UK primary) OR the Printify pair. If both are set, Printful wins.
PRINTFUL_API_TOKEN=…                                 # account-level token (Printful → Settings → API)
PRINTFUL_STORE_ID=…                                  # the "Manual order / API" store (Stores → Connect via API); without it the token is ignored
PRINTFUL_WEBHOOK_SECRET=…                            # long random string; v1 webhooks are unsigned, so it rides in the URL as ?secret=
PRINTFUL_CONFIRM=1                                   # default 1: draft then confirm (charges your Printful billing method). 0: leave drafts for review
PRINTIFY_API_TOKEN=…                                 # fallback only
PRINTIFY_SHOP_ID=…
PRINTIFY_WEBHOOK_SECRET=…
PRINTIFY_SEND_TO_PRODUCTION=1                        # default 1; 0 keeps Printify orders on hold for review
RESEND_API_KEY=re_…                                  # optional
EMAIL_FROM=Kitty <kitty@yourdomain>                  # optional; domain must be verified in Resend
```

Never set in a real deployment: `STRIPE_API_BASE`, `PRINTFUL_API_URL`,
`PRINTIFY_API_URL` (base-URL overrides) and `POD_IDS_JSON` (replaces
`pod-ids.json`). They exist only for the verify harness, which points the
adapters at mock servers on 127.0.0.1 (section 7). The code also defends
itself: in a production build (`NODE_ENV=production` or `VERCEL` set) the three
base URLs are honoured only when their hostname is `localhost` or `127.0.0.1`,
otherwise ignored with one `console.error`; `POD_IDS_JSON` is ignored whenever
`VERCEL` is set. The self-check reports any of the four as
`env.noHarnessOverrides`, and `/api/admin/status` lists them under `overrides`
(an empty list is the right answer on the live site).

## 4. Print provider: Printful (UK primary) or Printify (fallback)

`pod/index.ts` selects **Printful** when `PRINTFUL_API_TOKEN` + `PRINTFUL_STORE_ID`
are set (the UK primary: its Wolverhampton factory does the cap and hoodie
embroidery and Kornit water-based DTG, and ships UK orders from there), else
**Printify** when `PRINTIFY_API_TOKEN` + `PRINTIFY_SHOP_ID` are set, else the demo
provider. Never both at once: one shop, one fulfilment partner. A token without
a store id is the demo provider; `/admin` says "token only, no store id yet".
The provider is rebuilt whenever any of its env changes, so a store id landing
in Vercel takes effect on the next request.

### How a paid order reaches the provider

`stripe.ts` writes the order, answers Stripe, then runs `fulfil(order, items)`
(`fulfilment.ts`) in `after()`. `fulfil` maps every item with
`mapItemsToPod()` (`pod/types.ts`), in this order per variant:

1. `podProductId` + `podVariantId` written by hand in `src/config/products.ts`;
2. `src/config/pod-ids.json`, but only if it was generated for the configured
   provider **and** store id (ids mean nothing in another store);
3. Printful only: the **catalog blueprint** in `src/config/printful.ts`. The
   order carries the catalog `variant_id`, the print files as
   `NEXT_PUBLIC_SITE_URL` + `/print/…` and the item options (embroidery type,
   thread colours). This needs `NEXT_PUBLIC_SITE_URL` to be **https**, because
   Printful fetches the files; an http site leaves the variant unmapped.
4. Unmapped: the provider is never called.

So with Printful, orders flow the moment `PRINTFUL_STORE_ID` exists, before any
product has been created in the store. `products sync` (4a) is still worth
doing: a sync product carries the retail price and a thumbnail, and its mockups
show up in the Printful dashboard.

Before the provider is called the order is **claimed**: one conditional
update sets `orders.pod_provider` where `id` matches, `pod_order_id` is null
and (unless `force`) `pod_provider` is null, asking for the updated row back.
One row back means this run holds the order; none means another run does (a
Stripe retry racing the first delivery, or the admin button racing the
webhook), and nothing is sent. A provider failure releases the claim (sets
`pod_provider` back to null where `pod_order_id` is still null) so a retry is
possible. The admin button passes `force: true` after the webhook's 90 s grace
(4c), so a claim left by a run that died never blocks an order for good.

`fulfil` never throws. Every outcome is an `order_events` row:

| Event | Meaning | Order status |
|---|---|---|
| `pod_not_configured` | no provider pair in env | stays `paid` |
| `pod_unmapped` | some variant has no ids and no https catalog mapping (lists them); also an order with no items at all (`unmapped: []`), which never reaches the provider | stays `paid` |
| `pod_no_address` | the Stripe session had no shipping address | stays `paid` |
| `pod_claimed_elsewhere` | another fulfilment run holds the claim (or the order already has a provider id); nothing was sent | stays `paid` |
| `pod_failed` | the provider refused or timed out (message saved), or the claim itself could not be written; the claim is released | stays `paid` |
| `pod_submitted` | provider order created; payload has `providerOrderId`, `sentToProduction`, `note` | `submitted` |
| `pod_draft_unconfirmed` | appended right after `pod_submitted` when `sentToProduction` is false (`PRINTFUL_CONFIRM=0`, or the confirm failed): the provider holds a draft nobody has confirmed; payload `{ provider, providerOrderId, note }` | `submitted` |
| `pod_submitted_unrecorded` | provider accepted but our row update failed: set `pod_order_id` by hand, do **not** resubmit. `fulfil` still returns the order as `submitted` with the provider id, and the Stripe webhook's final update writes it into the row | stays `paid` until that update lands |

An order that already has `pod_order_id` is never resubmitted. The `/admin`
Orders card (4c) runs the same `fulfil` for orders left at `paid`.

### 4a. Printful (primary)

Setting up, in order (every command reads `.env.local`; the token is never
printed):

1. **Store.** Printful cannot create a store through the API. In the Printful
   dashboard: Stores → Connect via API (a "Manual order / API" store). Then
   `node scripts/printful.mjs status` lists the stores on the token; put the
   id in `.env.local` and Vercel as `PRINTFUL_STORE_ID`. Until then every
   store-dependent command stops with "no store id yet" and the app stays on
   the demo provider.
2. **Billing.** Printful → Billing → add a payment method. Confirming an order
   charges it for base cost + shipping. Without one, confirm fails and the order
   stays a draft (see the order flow below).
3. **Catalog check.** `node scripts/printful.mjs catalog`: every blueprint
   variant against the live catalog (catalog variant id, colour, size, USD base
   price, UK stock, the placements and options the product offers). Exit 1 on
   a missing variant or one that is not `in_stock` for the UK. Works without a
   store. As of 5 Oct 2026 all ten variants pass.
4. **Print files.** `node scripts/print-files.mjs` (or `npm run print-files`)
   writes `public/print/kitty-face-embroidery.png` (2000², five thread
   colours, flat), `kitty-face-ink.png` (1500², black only) and
   `missing-flyer-back.png` (2400×3394, black only) and checks them. **Commit
   and deploy them**: Printful downloads them from the live site both for
   `products sync` and for catalog orders.
5. **Sync the products.** With the store id set and the site deployed:
   `node scripts/printful.mjs printfiles` (print-area sizes per placement),
   `node scripts/printful.mjs products sync --dry-run` (prints the exact
   request bodies, writes nothing), then `node scripts/printful.mjs products
   sync`. It creates or updates the three sync products from the blueprints
   (`external_id` makes it idempotent: a second run is a PUT with the same
   ids) and writes `src/config/pod-ids.json` `{ provider: "printful", storeId,
   generatedAt, variants: { "<our id>": { productId, variantId } } }`. Commit
   it (the build imports the file, so the empty placeholder is committed too).
   `node scripts/pod-ids.mjs --write` does the same from an existing
   store (matching by the sync variants' `external_id`, or `--map=` for
   products made by hand).
6. **Webhook.** Put a long random `PRINTFUL_WEBHOOK_SECRET` in `.env.local` and
   Vercel, then `node scripts/printful.mjs webhooks register https://<domain>`
   (https only). It registers `https://<domain>/api/webhooks/pod?secret=…`
   for `package_shipped`, `package_returned`, `order_created`,
   `order_updated`, `order_failed`, `order_canceled`, `order_put_hold`,
   `order_remove_hold`, `order_refunded`. `webhooks list` shows it with the
   secret masked; `webhooks clear` removes it.

Order flow (`pod/printful.ts`, API v1; v2 is still Open Beta). Headers
`Authorization: Bearer <token>` and `X-PF-Store-Id: <store id>` on every call.

1. `POST /orders` with `{ external_id, shipping: "STANDARD", recipient: { name,
   address1, address2?, city, state_code?, country_code, zip, phone?, email? },
   items }`. `recipient.name` is the full name as the customer typed it
   (`PodAddress.fullName`), so a one-word name like "Prince" is sent once, not
   as "Prince Prince". Items are `{ sync_variant_id, quantity }` for
   store-mapped variants or `{ variant_id, quantity, files: [{ type:
   <placement>, url }], options?: [{ id, value }] }` for catalog-mapped ones.
   This creates a **draft** (no `confirm` query parameter).
2. Unless `PRINTFUL_CONFIRM=0`, `POST /orders/{id}/confirm` as a second call.
   Success: `sentToProduction: true`. Failure (typically no billing method):
   the draft is kept, `sentToProduction: false`, Printful's message in the
   event's `note`, nothing thrown. Confirm it later from `/admin` ("Confirm at
   Printful"), `node scripts/printful.mjs orders confirm <id> --yes` (it
   charges the Printful card, so without `--yes` it only shows the order and
   stops), or the Printful dashboard. With `PRINTFUL_CONFIRM=0` the note reads
   `draft: PRINTFUL_CONFIRM=0`.
3. `external_id` must be at most 32 characters of `[A-Za-z0-9_-]` (Printful's
   rule). A Stripe Checkout session id is about 66, so the adapter uses the
   Stripe id only when it fits and otherwise our order uuid without dashes
   (exactly 32 hex characters, deterministic per order).
4. If `POST /orders` fails, the adapter looks the order up with
   `GET /orders/@{external_id}`; if it exists (a Stripe retry, or a timeout
   after Printful created it) that id is returned instead of printing twice,
   with `note: recovered existing order by external_id (status …)`. A recovered
   order that is still a `draft` is then confirmed like a new one when confirm
   is on (`sentToProduction: true`, note `…; confirmed`; a failed confirm
   gives `sentToProduction: false` and `…; confirm failed: <message>`); with
   `PRINTFUL_CONFIRM=0` it stays a draft. A recovered order in any other
   status is reported as already in production.
5. A 429 waits `Retry-After` seconds (2 s default, 5 s cap) and retries once;
   calls time out after 15 s. A second 429 surfaces as `pod_failed`.

Reading back: `getOrder(id)` → `GET /orders/{id}`; `confirmOrder(id)` →
`POST /orders/{id}/confirm`. Printful statuses map to ours as `inprocess` →
`in_production`, `fulfilled` → `shipped`, `canceled` → `cancelled`, `failed` →
`failed`; `draft`, `inreview`, `pending`, `onhold`, `partial`, `archived` only
log. Tracking is read from `shipments[0]` (`carrier`/`service`,
`tracking_number`, `tracking_url`); a `tracking_url` that is not `http(s)` is
dropped, because the success page renders it as a link.

Webhook: **Printful v1 webhooks are not signed**, so the secret rides in the
URL; the route copies it into the `x-printful-webhook-secret` header and the
adapter requires it to equal `PRINTFUL_WEBHOOK_SECRET` (constant-time compare;
401 otherwise). A body whose `store` is not our store id is ignored with a
warning. `package_shipped` → status `shipped`, tracking saved;
`order_canceled` → `cancelled`; `order_failed` → `failed`; `order_updated` →
the mapped status, if any (`fulfilled` is `shipped` too); the rest are logged
against the order. Status only ever moves forward (`paid` → `submitted` →
`in_production` → `shipped` → `delivered`); `cancelled` / `failed` are accepted
unless the order is `delivered`. The shipped email goes out on the
**transition** to `shipped`, whichever event carried it first
(`order_updated` with status `fulfilled`, or `package_shipped`, which Printful
sends in no fixed order) and never twice; the same rule applies to "Refresh
from the maker" on `/admin` (4c).

Operator CLI, all of it: `node scripts/printful.mjs status | catalog |
printfiles | products sync [--dry-run] [--allow-http] | webhooks list |
register <https site> | clear | orders list [--status=…] [--full] | orders get
<id> | orders confirm <id> --yes | orders cancel <id> --yes | selftest`, each
with `--json` for machine output. `orders confirm` shows the order and stops
unless `--yes` is given, because confirming charges the Printful card on file.
Every error message passes through the same mask as `webhooks list`, so a
webhook URL's `?secret=` never reaches the terminal. `selftest` needs no
network (blueprints cover every variant, fit maths, print files present).
`--allow-http` exists only for a local experiment; Printful cannot fetch from
localhost anyway.

### 4b. Printify (fallback)

1. Create the three products in Printify (embroidered cap, embroidered hoodie,
   DTG long-sleeve). Publishing is not required for API orders.
2. `GET https://api.printify.com/v1/shops.json` with
   `Authorization: Bearer $PRINTIFY_API_TOKEN` → `PRINTIFY_SHOP_ID`.
3. Record the ids. Printify has **no catalog fallback**: every variant needs the
   shop's product id + variant id, or `createOrder` throws `PodUnmappedError`
   and `fulfil` records `pod_unmapped`. Variant titles never match our labels
   reliably, so the pairing is spelled out:

   ```sh
   node scripts/pod-ids.mjs                      # lists every product and variant id in the shop
   node scripts/pod-ids.mjs --write --map=cap-black=12345,cap-stone=12346,hoodie-black-s=…
   ```

   `--write` validates each of our ids against `products.ts` and each
   provider id against the shop, then writes `src/config/pod-ids.json` with
   `provider: "printify"` and the shop id. Hand-written ids in `products.ts`
   still win.
4. Order flow (verified against `https://developers.printify.com/openapi.json`):
   `POST /v1/shops/{shop_id}/orders.json` with
   `{ external_id, label, line_items: [{ product_id, variant_id, quantity }], shipping_method: 1, send_shipping_notification: false, address_to: { first_name, last_name, email, phone, country, region, address1, address2, city, zip } }`
   → `{ id }`. Then `POST …/orders/{id}/send_to_production.json` (skipped when
   `PRINTIFY_SEND_TO_PRODUCTION=0`, leaving the order on hold in Printify for review;
   `/admin` "Send to production" or `confirmOrder` does it later). `getOrder`
   reads `GET …/orders/{id}.json`: `in-production` / `sending-to-production` →
   `in_production`, `fulfilled` → `shipped`, `canceled` → `cancelled`, tracking
   from `shipments[0]` `{ carrier, number, url }` (a `url` that is not
   `http(s)` is dropped). A 429 is retried once after `Retry-After` (5 s cap).
   If `POST …/orders.json` fails, the adapter reads
   `GET …/orders.json?limit=50` and, if an order with the same `external_id`
   (the Stripe session id) is there, returns it with `note: recovered existing
   order by external_id (status …)` instead of ordering twice; `pending`,
   `on-hold` and `payment-not-received` count as not yet in production.
   Printify charges the card on file in Printify for the base cost + shipping.
5. Shipment webhook: Printify → My account → Connections → Webhooks (or
   `POST /v1/shops/{shop_id}/webhooks.json` with `{ topic, url, secret }`), URL
   `https://<your-domain>/api/webhooks/pod`, topics `order:shipment:created`,
   `order:shipment:delivered`, `order:sent-to-production`, `order:updated`.
   Put the same secret in `PRINTIFY_WEBHOOK_SECRET`; the route verifies
   `X-Pfy-Signature` = `sha256=` + HMAC-SHA256(raw body, secret) with a
   constant-time compare. `order:shipment:created` → status `shipped`, tracking
   saved, customer emailed.

### 4c. The Orders card on /admin

`GET /api/admin/orders?limit=30[&status=]` (bearer token → `is_admin()`, like
`/api/admin/status`; 503 without `SUPABASE_SERVICE_ROLE_KEY`) lists the newest
orders with items, provider id, tracking, `processedAt`, the latest event and
`needsConfirm`, never the full address or phone. `needsConfirm` is read from
the newest of the order's `pod_submitted` / `pod_draft_unconfirmed` /
`pod_confirmed` events: true while the provider's copy is a draft nobody has
confirmed, false once a `pod_confirmed` reports production. The response also
says which provider is live and whether it offers confirm / refresh, so the
card shows only buttons that can do something.

Two chips on a row besides its status: **draft: not confirmed** when
`needsConfirm` is true (the order will not be made until someone confirms it),
and **fulfilment did not finish** when `processed_at` is still empty two
minutes after the order was created (the Stripe webhook's deferred work died;
read `last:` and use Send to the maker).

`POST /api/admin/orders/{id}` with `{ "action": "fulfil" | "confirm" | "refresh" }`
(`maxDuration` 60 s, the same budget as the Stripe webhook):

- **Send to the maker** (`fulfil`): a merch order at `paid` with no provider id.
  Runs `fulfil()` exactly as the webhook would, with `force: true`, so a claim
  left behind by a run that died (`pod_provider` set, no `pod_order_id`) is
  taken over. Refused (409) for 90 s after the order is created while
  `processed_at` is null, so it cannot race the Stripe webhook's deferred
  fulfilment into a second provider order. Events: `admin_fulfil`, then
  whatever `fulfil` records.
- **Confirm at Printful** / **Send to production** (`confirm`): shown only for
  a `submitted` order with a provider id and `needsConfirm`, when the live
  provider matches the order's and implements `confirmOrder`. Events:
  `pod_confirmed` or `pod_confirm_failed` (with the provider's message).
  Status stays `submitted`; refresh moves it.
- **Refresh from the maker** (`refresh`): reads the order back with `getOrder`
  and moves status forward by the same rule as the webhook, or fills in
  tracking. When that moves the order to `shipped`, the shipped email is sent
  then (once; the pod webhook will not send it again). Events: `pod_refreshed`
  `{ providerStatus, status, tracking }` or `pod_refresh_failed`, plus
  `email_shipped_sent` / `email_shipped_skipped` on the transition.

In demo mode the card renders "Demo mode: no orders." and makes no request
(`npm run verify`'s admin journey checks exactly that).
Connected services shows Printful as connected / token only / not yet, and a
"Print files" line: how many variants have a blueprint, how many have store
ids for the configured store, and whether `NEXT_PUBLIC_SITE_URL` is https.

## 5. Email (Resend)

Set `RESEND_API_KEY` and `EMAIL_FROM` (a verified domain in Resend). Two mails:
order confirmation (from the Stripe webhook) and shipped-with-tracking (sent
once, on the transition to `shipped`, by whichever learns of it first: the
print provider's webhook or "Refresh from the maker" on `/admin`). Without the
keys, both are logged to the server console.
Stripe also sends its own receipt if you enable it under Settings → Emails.

## 6. Fee maths for the £1 snack

Stripe UK standard pricing (stripe.com/gb/pricing, checked Sept 2026):
**1.5% + 20p** per successful standard UK card payment (2.5% + 20p EEA cards,
3.15% + 20p international, +2% if currency conversion applies). Apple Pay and
Google Pay cost the same as the underlying card.

For a £1.00 snack with a UK card:

```
fee  = 1.5% × £1.00 + £0.20 = £0.015 + £0.20 = £0.215  → Stripe rounds to £0.22
net  = £1.00 − £0.22 = £0.78
```

So Kitty keeps about **78p of every £1** (22% goes in fees). The fixed 20p is
what hurts at this price: a £2 snack nets £1.77 (11.5% fees), a £3 snack nets
£2.76 (8.2%). If the snack button gets popular, raise `SNACK.pricePence` in
`src/config/products.ts` or offer £1/£3/£5 options; nothing else needs changing.

Merch: a £55 hoodie + £3.99 shipping = £58.99 charged; Stripe fee 1.5% + 20p =
£1.08; the print provider then bills its base cost + shipping separately.
Printful's catalog base costs (USD, read 5 Oct 2026): cap 17.95; hoodie 24.25 +
2.95 left-chest embroidery; long-sleeve 18.75 + 5.95 back print + 5.95 sleeve
print; UK shipping on top. Kitty charges £28, £55 and £38 + £3.99 shipping.

## 7. Exercising it

Demo (no env):

```sh
curl -s -X POST localhost:3200/api/checkout -H 'content-type: application/json' -d '{"variantId":"hoodie-black-m","quantity":1}'
# → {"url":"http://localhost:3200/checkout/success?demo=1&variant=hoodie-black-m&qty=1"}
curl -s -X POST localhost:3200/api/snack
curl -s localhost:3200/api/commerce/status | jq
```

Config only (no app, no store needed): `node scripts/printful.mjs selftest`
(blueprints, fit maths, print files), `node scripts/printful.mjs catalog`
(live catalog, read-only), `node scripts/stripe-selftest.mjs` (test key).

Live (test keys): open `/store`, press Buy, pay with `4242…`, land on
`/checkout/success?session_id=cs_test_…`, then check `orders`, `order_items`
and `order_events` in Supabase, and the Orders card on `/admin`. Keep
`NEXT_PUBLIC_SITE_URL=https://kittyfive.vercel.app` in `.env.local` for this
(the print-file URLs in a catalog order are built from it): `origin.ts` sends
a request whose Host is `localhost`, `127.0.0.1` or `[::1]` back to that host
(http unless `x-forwarded-proto` says otherwise) before it looks at
`NEXT_PUBLIC_SITE_URL`, so Stripe still returns you to
`localhost:3200/checkout/success`. With `PRINTFUL_CONFIRM=0` the Printful
order is a draft: the `/admin` row carries the **draft: not confirmed** chip,
`node scripts/printful.mjs orders list --status=draft` shows the same id, then
`orders cancel <id> --yes` so it is never produced. `stripe trigger
checkout.session.completed` also works but carries no metadata, so it records
an order of kind `merch` with no items (harmless; it ends as `pod_unmapped`
with `unmapped: []` and is useful for signature checks).

Harness: `npm run verify:commerce` (`scripts/verify-commerce.mjs`, with
`scripts/commerce-mocks.mjs`) stands up mock Stripe, Supabase (PostgREST),
Printful and Printify servers on 127.0.0.1 and starts the real production
build on ports 3202 (the Printful run) and 3203 (the Printify run) with every
commerce variable set explicitly, so nothing in `.env.local` reaches a run. It
points the app at the mocks through `STRIPE_API_BASE`, `PRINTFUL_API_URL` (the
mock serves `/orders`, `/orders/{id}/confirm`, `/orders/@{external_id}`,
`/orders/{id}`), `PRINTIFY_API_URL` (replaces the whole
`https://api.printify.com/v1` base, so the mock serves `/shops/…` directly) and
`POD_IDS_JSON`. It proves Stripe → Supabase → provider → webhooks → emails
without a real token or store, and it passes with no keys at all. It rebuilds
`.next` when anything under `src/` (or `next.config.ts`, `package.json`) is
newer than `.next/BUILD_ID`; `npm run verify:commerce -- --no-build` skips
that, `-- --build` forces it, `-- --only=printful` / `--only=printify` runs one
provider. Results land in `.verify/commerce-results.json`, each run's site
output in `.verify/commerce-site-<run>.log`; exit 1 on any failure.

## Known limits

- Order + items are two inserts, not one transaction. If the second fails the
  webhook returns 500, Stripe retries, and the retry resumes: it inserts the
  missing items, runs fulfilment and email, then sets `orders.processed_at`
  (re-asserting `status`, `pod_provider` and `pod_order_id` in the same update
  when fulfilment returned a provider id, so an unrecorded submission still
  lands in the row). Only a delivery for an order whose `processed_at` is set
  is answered as a duplicate. Fulfilment and email run in `after()` once the 200 is sent, so a
  slow print provider never stalls the Checkout redirect.
- Rate limits are per instance and in memory (`src/lib/rateLimit.ts`):
  30 chat calls, 12 checkouts and 12 snacks per IP per 10 minutes. Move to
  Upstash/Vercel KV if the site gets real traffic.
- Set the Stripe webhook endpoint's API version to 2025-03-31.basil or later in
  the Dashboard; the handler also re-fetches each session with the SDK's
  pinned version, so an older endpoint version still yields the address.
- Printful v1 webhooks are unsigned: register the endpoint with
  `?secret=<PRINTFUL_WEBHOOK_SECRET>`. In live mode the pod webhook refuses to
  run at all (503) until the active provider has a secret configured.
- Printful confirm needs a billing method on the Printful account. Until there
  is one, every order is created as a draft, `pod_submitted` carries
  `sentToProduction: false` with Printful's message and a
  `pod_draft_unconfirmed` event follows; `/admin` shows the row as "draft: not
  confirmed". Nothing is lost, but nothing is printed either until someone
  confirms.
- Catalog orders need an https `NEXT_PUBLIC_SITE_URL` and the `/print` files
  deployed. `selfcheck.ts` (`printful.catalogOrderNeedsHttpsSiteUrl`) and the
  Print files line on `/admin` show this.
- A 429 from either provider is retried once, after `Retry-After` capped at
  5 s. A sustained 429 is `pod_failed`, the claim is released, and the admin
  resubmits.
- The cap blueprint sends the generic `thread_colors` option, which the live
  catalog did not list for product 206 (it lists `thread_colors_3d`,
  `thread_colors_front_large` and others). `catalog` prints a WARN, not a
  failure; `printfiles` (needs a store) lists the option ids Printful accepts.
  If a sync or order is rejected on it, drop or rename that line in
  `src/config/printful.ts`.
- One variant per Checkout Session (the store buys one thing at a time by design).
- `order_items.unit_pence` is what the session charged per unit
  (`session.amount_subtotal / quantity`, which excludes shipping), falling back
  to `products.ts` only when Stripe reports no subtotal, so a price change
  while a session is open never shows a wrong line on the success page or in
  the email.
- Refunds are handled in the Stripe dashboard; the DB is not updated on refund.
