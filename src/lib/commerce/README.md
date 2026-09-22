# Kitty commerce — how to go live

Real money only. There is no play economy. With **no env vars** everything runs in
DEMO mode: checkout redirects straight to `/checkout/success?demo=1`, the webhook
returns `{ received: true, demo: true }`, and `DemoBanner` shows
**DEMO: no real payments** on every page that renders it.

Live mode switches on automatically when all four of these are present:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`. Printify and Resend are optional extras.

Check what the server thinks at any time: `GET /api/commerce/status`
(booleans only, never secrets; in demo mode it also runs `selfcheck.ts`).

## Files

| File | Role |
|---|---|
| `types.ts` | `Commerce` interface, `CommerceError`, `validateQuantity` |
| `env.ts` | reads env, `isLive()` |
| `index.ts` | `getCommerce()`: live if `isLive()` else demo; `status()` |
| `stripe.ts` | live implementation (Checkout Sessions, webhook, fulfilment, email) |
| `demo.ts` | in-memory implementation |
| `orders.ts` | Supabase writes: idempotent insert, status updates, append-only events |
| `supabaseAdmin.ts` | service-role client, server-only (throws if imported in a browser) |
| `pod/printify.ts`, `pod/demo.ts` | print-on-demand adapters behind `pod/types.ts` |
| `email.ts` | Resend if configured, else `console.log` |
| `selfcheck.ts` | config invariants for `/api/commerce/status` |
| `origin.ts`, `format.ts` | helpers |

Routes: `POST /api/checkout`, `POST /api/snack`, `POST /api/webhooks/stripe`,
`POST /api/webhooks/pod`, `GET /api/commerce/status`. Page: `/checkout/success`.
Components: `components/commerce/DemoBanner.tsx`, `components/commerce/SnackButton.tsx`.

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
   (Use whatever port `next dev` is actually on; the verify harness uses 3200.)
5. Production webhook: Developers → Webhooks → Add endpoint →
   `https://<your-domain>/api/webhooks/stripe`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`. Copy its signing secret into Vercel.
6. Test cards: `4242 4242 4242 4242`, any future date, any CVC, any UK postcode.

The webhook reads `await req.text()` and verifies with
`stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)`.
Bad signature → 400. Handled or duplicate → 200. Unexpected failure → 500 so
Stripe retries. Print-provider failures are logged to `order_events` and still
return 200 (the money is already taken; the owner fulfils by hand).

## 2. Supabase

1. Create a project. Copy the URL to `NEXT_PUBLIC_SUPABASE_URL` and the
   **service_role** key to `SUPABASE_SERVICE_ROLE_KEY` (server-only, never
   `NEXT_PUBLIC_`).
2. Run `supabase/commerce.sql` in the SQL editor (or convert it to a migration in Phase 6). It creates `orders`,
   `order_items`, `order_events`, enables RLS with **no policies**, and creates
   the `snacks_public` view (count + last snack time) for a public counter.
3. Nothing in the browser ever reads or writes these tables. The Supabase
   advisor will flag `snacks_public` as a "security definer view": that is
   intentional and documented in the SQL.

## 3. Vercel env

Settings → Environment Variables. Production and Preview separately:

```
NEXT_PUBLIC_SITE_URL=https://kitty.example          # Stripe return URLs and product image URLs
STRIPE_SECRET_KEY=sk_live_…                          # sk_test_… in Preview
STRIPE_WEBHOOK_SECRET=whsec_…                        # one per endpoint
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=…
PRINTIFY_API_TOKEN=…                                 # optional
PRINTIFY_SHOP_ID=…                                   # optional
PRINTIFY_WEBHOOK_SECRET=…                            # optional but recommended
PRINTIFY_SEND_TO_PRODUCTION=1                        # optional; 0 keeps orders on hold for review
RESEND_API_KEY=re_…                                  # optional
EMAIL_FROM=Kitty <kitty@yourdomain>                  # optional; domain must be verified in Resend
```

## 4. Printify

1. Create the three products in Printify (embroidered cap, embroidered hoodie,
   screen-printed long-sleeve). Publishing is not required for API orders.
2. `GET https://api.printify.com/v1/shops.json` with
   `Authorization: Bearer $PRINTIFY_API_TOKEN` → `PRINTIFY_SHOP_ID`.
3. `GET /v1/shops/{shop_id}/products.json` → for each product copy `id` and each
   variant's integer `id`. Put them in `src/config/products.ts`:

   ```ts
   { id: "hoodie-black-m", label: "Black / M", colour: "#111111", size: "M",
     podProductId: "64f1c2…", podVariantId: 12345 },
   ```

   **A variant without both `podProductId` and `podVariantId` is never sent to
   Printify.** The webhook records an `order_events` row of type `pod_unmapped`,
   leaves the order at status `paid`, and the owner fulfils it by hand.
4. Order flow (verified against `https://developers.printify.com/openapi.json`):
   `POST /v1/shops/{shop_id}/orders.json` with
   `{ external_id, label, line_items: [{ product_id, variant_id, quantity }], shipping_method: 1, send_shipping_notification: false, address_to: { first_name, last_name, email, phone, country, region, address1, address2, city, zip } }`
   → `{ id }`. Then `POST …/orders/{id}/send_to_production.json` (skipped when
   `PRINTIFY_SEND_TO_PRODUCTION=0`, leaving the order on hold in Printify for review).
   Printify charges the card on file in Printify for the base cost + shipping.
5. Shipment webhook: Printify → My account → Connections → Webhooks (or
   `POST /v1/shops/{shop_id}/webhooks.json` with `{ topic, url, secret }`), URL
   `https://<your-domain>/api/webhooks/pod`, topics `order:shipment:created`,
   `order:shipment:delivered`, `order:sent-to-production`, `order:updated`.
   Put the same secret in `PRINTIFY_WEBHOOK_SECRET`; the route verifies
   `X-Pfy-Signature` = `sha256=` + HMAC-SHA256(raw body, secret) with a
   constant-time compare. `order:shipment:created` → status `shipped`, tracking
   saved, customer emailed.

## 5. Email (Resend)

Set `RESEND_API_KEY` and `EMAIL_FROM` (a verified domain in Resend). Two mails:
order confirmation (from the Stripe webhook) and shipped-with-tracking (from the
Printify webhook). Without the keys, both are logged to the server console.
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
£1.08; Printify then bills its base cost + shipping separately.

## 7. Exercising it

Demo (no env):

```sh
curl -s -X POST localhost:3200/api/checkout -H 'content-type: application/json' -d '{"variantId":"hoodie-black-m","quantity":1}'
# → {"url":"http://localhost:3200/checkout/success?demo=1&variant=hoodie-black-m&qty=1"}
curl -s -X POST localhost:3200/api/snack
curl -s localhost:3200/api/commerce/status | jq
```

Live (test keys): open `/store`, press Buy, pay with `4242…`, land on
`/checkout/success?session_id=cs_test_…`, then check `orders`, `order_items`
and `order_events` in Supabase. `stripe trigger checkout.session.completed`
also works but carries no metadata, so it records an order of kind `merch`
with no items (harmless; useful for signature checks).

## Known limits

- Order + items are two inserts, not one transaction. If the second fails the
  webhook returns 500, Stripe retries, and the retry resumes: it inserts the
  missing items, runs fulfilment and email, then sets `orders.processed_at`.
  Only a delivery for an order whose `processed_at` is set is answered as a
  duplicate. Fulfilment and email run in `after()` once the 200 is sent, so a
  slow print provider never stalls the Checkout redirect.
- Rate limits are per instance and in memory (`src/lib/rateLimit.ts`):
  30 chat calls, 12 checkouts and 12 snacks per IP per 10 minutes. Move to
  Upstash/Vercel KV if the site gets real traffic.
- Set the Stripe webhook endpoint's API version to 2025-03-31.basil or later in
  the Dashboard; the handler also re-fetches each session with the SDK's
  pinned version, so an older endpoint version still yields the address.
- Printful v1 webhooks are unsigned: register the endpoint with
  `?secret=<PRINTFUL_WEBHOOK_SECRET>`. In live mode the pod webhook refuses to
  run at all until the active provider has a secret configured.
- One variant per Checkout Session (the store buys one thing at a time by design).
- Refunds are handled in the Stripe dashboard; the DB is not updated on refund.
