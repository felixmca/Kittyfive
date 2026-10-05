# Handover 06: Printful wired to Kittyfive (5 Oct 2026)

Felix was away for eight hours and asked for Printful / Printify to be wired
to Kittyfive, building against API keys that would arrive later. The Printful
token was already in `.env.local` and valid; what the account lacks is a
**store**, and Printful cannot create one through its API. So everything was
built, checked against the live catalog (read-only) and against local mocks of
both providers, and left ready for the moment the store id lands. No money
moved; nothing was ordered. This file is the log; your part comes first.

## For Felix, when you are back

Short version: eight steps, about an hour, most of it waiting for deploys.
Steps 1 to 3 are the ones only you can do. Every command runs from the project
root in Git Bash and reads `.env.local` on its own. The token is never printed.

**Before anything:** if `git status` still lists this session's files as
uncommitted (`public/print/` (the three PNGs: Printful fetches them from the
live site, so they must be committed and deployed before `products sync`),
`src/config/pod-ids.json` (the build imports it, so commit it even while it is
the empty placeholder), `scripts/printful.mjs`, `scripts/verify-commerce.mjs`,
`src/config/printful.ts`, `supabase/migrations/20261005080000_commerce.sql`
and the rest), commit and push them. Nothing in them is secret; `.env.local`
is ignored by git. Vercel deploys on push.

**Vercel env:** this session tried to add the Printful variables with
`vercel env add` and the tool's permission layer refused writes to the secret
store, so **nothing was added**. Production still holds only
`ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Every other name in steps 1, 5 and 6 is yours
to add by hand (step 6 has the table).

### 1. Create the Printful store (5 min)

Printful needs a store to file orders under, even for API orders.

1. Sign in at printful.com. Left menu **Stores** → **Connect via API**. (Printful
   may call the option "Manual order platform / API". It is the one that is not
   Shopify / Etsy / etc.) Any name; "Kittyfive" is fine.
2. Run `node scripts/printful.mjs status`. The line
   `stores on this token:` now shows `<id> "Kittyfive" (…)`. Copy the id.
3. Open `.env.local` and set `PRINTFUL_STORE_ID=<that id>`.
4. Vercel → project **kittyfive** → **Settings → Environment Variables**. Add
   `PRINTFUL_STORE_ID` with the same id, and `PRINTFUL_API_TOKEN` pasted from
   `.env.local` with **Sensitive** ticked (Vercel then never shows it again),
   both for **Production** and **Preview**. Add `PRINTFUL_CONFIRM` = `0` at the
   same time if you want to look at each order before it is charged (open
   question 4).

**Done when** `node scripts/printful.mjs status` prints the store under
`PRINTFUL_STORE_ID` and no longer says "no store id yet".

### 2. Add a billing method at Printful (3 min)

Printful → **Billing → Billing methods** → add a card. Confirming an order
charges it for base cost + shipping. Without a card every order is created as a
draft, the confirm step fails with a clear message in the order's events, and
you confirm by hand later. Nothing is lost either way.

**Done when** a card shows under Billing methods.

### 3. Check the catalog (1 min, works already)

`node scripts/printful.mjs catalog`

It checks all ten variants against Printful's live catalog: the catalog
variant id, colour, size, USD base price, UK stock, and the placements and
options each product offers. Today its last line starts with `RESULT: PASS`.
One `WARN` line about the cap's `thread_colors` option is expected (open
question 1).

**Done when** it says PASS.

### 4. Put the products in your store (10 min)

Orders already work without this: a variant with no store ids is ordered
straight from the Printful catalog with our print files attached. Do this
step anyway so the products carry a retail price and a thumbnail and you can
see the mockups in Printful.

1. Check the print files are live:
   `https://kittyfive.vercel.app/print/kitty-face-embroidery.png` should show
   Kitty's face on a transparent background. (If it is a 404, the commit from
   "Before anything" has not deployed yet.)
2. Make sure `NEXT_PUBLIC_SITE_URL=https://kittyfive.vercel.app` in `.env.local`
   (Printful fetches the files from there; http is refused).
3. `node scripts/printful.mjs printfiles`: prints the print-area size for the
   cap front, the hoodie's left chest and the long-sleeve's back and sleeve.
   Note the `thread_colors*` option ids it lists for the cap (open question 1).
4. `node scripts/printful.mjs products sync --dry-run`: prints the three
   request bodies, writes nothing. Read the variant lines.
5. `node scripts/printful.mjs products sync`: creates **Kitty Cap**, **Kitty
   Hoodie** and **Missing Poster Long-Sleeve** in the store and writes
   `src/config/pod-ids.json`. Running it again updates in place with the same
   ids.
6. Commit `src/config/pod-ids.json` (now with the ten variants) and push.

**Done when** `node scripts/printful.mjs status` lists `kitty-cap`,
`kitty-hoodie` and `kitty-longsleeve` as present, and `pod-ids.json` has ten
variants.

### 5. Register the webhook (5 min)

This is how an order moves to `shipped` and the customer gets a tracking email.

1. Make a secret: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
2. Put it in `.env.local` as `PRINTFUL_WEBHOOK_SECRET=…` and in Vercel
   (Production and Preview) under the same name.
3. `node scripts/printful.mjs webhooks register https://kittyfive.vercel.app`
   It registers `https://kittyfive.vercel.app/api/webhooks/pod?secret=…` for
   nine event types (package_shipped, package_returned, order_created,
   order_updated, order_failed, order_canceled, order_put_hold,
   order_remove_hold, order_refunded). Printful v1 webhooks are unsigned, so the
   secret in the URL is the check; that is expected.

**Done when** `node scripts/printful.mjs webhooks list` shows the URL (secret
masked) and the nine types.

### 6. The rest of the Vercel env (10 min)

Production today holds only `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Live mode needs:

| Name | Where it comes from |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys. `sk_test_…` in Preview, `sk_live_…` in Production only |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → Add endpoint `https://kittyfive.vercel.app/api/webhooks/stripe`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`; copy its signing secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Kittyfive → Project Settings → API → service_role (the secret one) |
| `PRINTFUL_API_TOKEN` | the token in `.env.local`, pasted by you with **Sensitive** ticked (Step 1). Not added by this session: `vercel env add` was refused |
| `PRINTFUL_STORE_ID`, `PRINTFUL_WEBHOOK_SECRET` | Steps 1 and 5 |
| `PRINTFUL_CONFIRM` | `0` to review every order as a draft before it is charged; `1` or unset to confirm automatically (open question 4). Set `0` yourself to start with; this session added nothing to Vercel |

Then **Deployments → ⋯ → Redeploy** so the values are picked up.

**Done when** you sign in on the live site and `/admin` → Connected services
says `Printful (the maker): connected`, and the **Print files** line reads
`10/10 blueprints · … store ids · site URL is https` (the store-ids count fills
in after Step 4).

### 7. One test order, then one real one (15 min)

Locally, `.env.local` has `PRINTFUL_CONFIRM=0`, so a test order is a Printful
draft: nothing charged, nothing made. Live mode locally needs
`STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`
and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (the service-role key is not
there yet: Supabase → Project Settings → API). Keep
`NEXT_PUBLIC_SITE_URL=https://kittyfive.vercel.app` in there too: the order's
print-file URLs are built from it, and a request from localhost is sent back
to localhost regardless (`src/lib/commerce/origin.ts`), so you still land on
`localhost:3200` after paying.

Before any of this, with no keys at all: `npm run verify:commerce` must pass.
It is the same money path against mocks on this machine (it rebuilds the site
when `src/` has changed). If it fails, the code needs looking at, not your
accounts.

1. `npm run dev -- -p 3200`; in another terminal `stripe listen --forward-to
   localhost:3200/api/webhooks/stripe` and put the `whsec_…` it prints in
   `.env.local` as `STRIPE_WEBHOOK_SECRET` (restart the dev server).
2. `http://localhost:3200/store` → Buy → card `4242 4242 4242 4242`. You land
   back on `http://localhost:3200/checkout/success?session_id=…`.
3. `/admin` → Orders: the row is `submitted`, `Printful #<id>`, with the chip
   **draft: not confirmed** (last event `email_confirmation_skipped` until
   Resend is set). `node scripts/printful.mjs orders list --status=draft`
   shows the same id.
4. `node scripts/printful.mjs orders cancel <id> --yes` so it is never made.
5. On the live site, once Step 6 is done and Stripe is in live mode: buy the
   cheapest thing yourself, watch it appear on `/admin` and in Printful, cancel
   it at Printful while it is a draft, refund yourself in Stripe.

**Done when** a real card purchase on kittyfive.vercel.app creates a Printful
order you can see in both places. You are selling. Vercel Pro and Supabase Pro
first (Hobby forbids commercial use; Free pauses after a week idle).

### 8. Four decisions (yours)

See "Open questions" below: the cap's thread-colour option, the long-sleeve's
"organic cotton" copy, the missing product images, and `PRINTFUL_CONFIRM`.

## What was built

Several agents worked in one tree, each on its own files; only the files
listed here changed.

**Printful and Printify adapters** (`src/lib/commerce/pod/`)
- `printful.ts`: API v1, checked against developers.printful.com on 5 Oct.
  `POST /orders` creates a draft; unless `PRINTFUL_CONFIRM=0`, a second call
  `POST /orders/{id}/confirm` pays and starts production. A failed confirm (no
  billing method) keeps the draft and records Printful's message instead of
  throwing. If the POST fails, `GET /orders/@{external_id}` recovers an order
  Printful already created, so a Stripe retry never prints twice; a recovered
  draft is confirmed like a new one when confirm is on (note `…; confirmed`,
  or `…; confirm failed: …`), and left alone with `PRINTFUL_CONFIRM=0`. Every
  call retries once on 429 after `Retry-After` (capped at 5 s). The recipient
  name is the full name as typed, so "Prince" is not sent as "Prince Prince";
  a tracking URL is kept only if it is http(s). `confirmOrder` and `getOrder`
  for the admin page. The webhook check is constant-time and ignores bodies
  for another store id. Pure helpers (`buildPrintfulOrderBody`,
  `mapPrintfulStatus`, `parsePrintfulPayload`, `printfulExternalId`) are
  exported for the harness.
- `external_id`: Printful allows 32 characters of letters, digits, `-` and `_`.
  A Stripe session id is about 66, so the adapter uses it only when it fits and
  otherwise our order uuid without dashes (exactly 32 hex characters).
- `printify.ts`: same shape (send_to_production, `confirmOrder`, `getOrder`,
  429 retry capped at 5 s, HMAC check, http(s)-only tracking URL). If the
  order POST fails it reads `GET /shops/{shop}/orders.json?limit=50` and
  returns an order with the same `external_id` if one is there (note
  `recovered existing order by external_id (status …)`). No catalog fallback:
  every item needs the shop's ids.
- `demo.ts`: parses both webhook shapes; `index.ts`: the provider is rebuilt
  whenever any of its env changes, so a store id landing in Vercel takes
  effect on the next request.

**Mapping and fulfilment**
- `src/config/printful.ts`: the three blueprints (catalog products 206, 146,
  356; our ten variant ids → catalog variant ids; placements
  `embroidery_front`, `embroidery_chest_left`, `back`, `sleeve_left`; print
  file paths; embroidery type and thread colours).
- `src/config/pod-ids.ts` + `pod-ids.json`: generated store ids, used only when
  their provider and store id match the configured ones; `POD_IDS_JSON`
  overrides the file (harness).
- `src/lib/commerce/pod/types.ts` `mapItemsToPod()`: hand-written ids in
  `products.ts` → `pod-ids.json` → Printful catalog blueprint (needs https
  `NEXT_PUBLIC_SITE_URL`) → unmapped.
- `src/lib/commerce/fulfilment.ts` `fulfil()`: never throws; every outcome is
  an `order_events` row (`pod_submitted`, `pod_draft_unconfirmed`,
  `pod_not_configured`, `pod_unmapped` (also for an order with no items),
  `pod_no_address`, `pod_claimed_elsewhere`, `pod_failed`,
  `pod_submitted_unrecorded`). Before the provider is called the order is
  claimed with one conditional update of `orders.pod_provider` (where
  `pod_order_id` is null, and `pod_provider` is null unless forced); no row
  back means another run holds it and nothing is sent. A provider failure
  releases the claim. Called by the Stripe webhook in `after()` and by the
  admin button (which forces past a dead claim after the 150 s grace).
- `src/lib/commerce/stripe.ts`: the deferred work's last update sets
  `processed_at` and re-asserts `status` / `pod_provider` / `pod_order_id` when
  fulfilment returned a provider id; `order_items.unit_pence` is what the
  session charged (`amount_subtotal / quantity`), falling back to
  `products.ts`.
- `src/lib/commerce/origin.ts`: a request whose Host is `localhost`,
  `127.0.0.1` or `[::1]` always returns to that host, before
  `NEXT_PUBLIC_SITE_URL` is consulted, so a local test with the https site URL
  set still lands on localhost.
- `src/lib/commerce/env.ts` + `src/config/pod-ids.ts`: `STRIPE_API_BASE`,
  `PRINTFUL_API_URL` and `PRINTIFY_API_URL` are honoured in a production build
  only when they point at `localhost` / `127.0.0.1` (one `console.error`
  otherwise); `POD_IDS_JSON` is ignored on Vercel. `isDeployed()` and
  `harnessOverridesPresent()`; the self-check has `env.noHarnessOverrides` and
  `/api/admin/status` an `overrides` list.
- `src/app/checkout/success/page.tsx`: the `failed` label is "Something went
  wrong with this order. We will be in touch." (a Printful failure after
  payment is not a payment failure).
- `src/lib/commerce/selfcheck.ts`: new checks `printful.blueprintsCoverEveryVariant`,
  `printful.catalogOrderNeedsHttpsSiteUrl`, `podIds.matchesConfiguredStore`.

**Operator CLI and print files**
- `scripts/printful.mjs` (`npm run printful -- <command>`): `status`,
  `catalog`, `printfiles`, `products sync [--dry-run] [--allow-http]`,
  `webhooks list | register <https site> | clear`, `orders list [--status=]
  [--full] | get <id> | confirm <id> --yes | cancel <id> --yes`, `selftest`;
  `--json` everywhere; 20 s timeouts; hints on 401/403/404/429; exit 1 on
  failure. `orders confirm` shows the order and refuses without `--yes` (it
  charges the Printful card); every error message is masked, so a webhook
  URL's `?secret=` never reaches the terminal.
- `scripts/print-files.mjs` (`npm run print-files`) → `public/print/`:
  `kitty-face-embroidery.png` (2000², exactly the five thread colours, flat,
  every stroke at least 3% of the height so it embroiders at 1.75 in),
  `kitty-face-ink.png` (1500², black only, bib and eye whites transparent so
  the white shirt shows through), `missing-flyer-back.png` (2400×3394, black
  only, no background). Each is read back and checked.
- `scripts/store/kitty-face-svg.mjs`: Kitty's face as one shared module
  (`merch-textures.mjs` now imports it; its output is byte-identical).
- `scripts/pod-ids.mjs`: `--write` records a store's ids in `pod-ids.json`
  (Printful by `external_id`; Printify with `--map=our-id=provider-id,…`).

**Database**
- `supabase/migrations/20261005080000_commerce.sql`: `orders`, `order_items`,
  `order_events`, triggers, RLS on with no policies, the `snacks_public` view.
  Applied to Kittyfive (twice, to prove it is idempotent) and recorded as
  version `20261005080000`. `supabase/commerce.sql` is now a pointer.
- `supabase/tests/rls-smoke.sql`: a "commerce (REAL MONEY)" section: anon and
  signed-in users can neither read nor write the three tables; the view counts
  only paid snacks; `order_events` is append-only; `updated_at` moves.

**Admin**
- `GET /api/admin/orders?limit=30[&status=]` and
  `POST /api/admin/orders/{id}` `{ action: "fulfil" | "confirm" | "refresh" }`
  (`src/app/api/admin/orders/`), admins only, JSON errors, 409 on every
  precondition (including a 150 s grace after an order is created, so the button
  cannot race the Stripe webhook into a second Printful order).
- `src/components/admin/Orders.tsx`: the Orders card with Send to the maker,
  Confirm at Printful (or Send to production for Printify), Refresh from the
  maker. The Confirm button and a **draft: not confirmed** chip appear only
  when the order's `needsConfirm` is true (read in `orders.ts` from the newest
  of `pod_submitted` / `pod_draft_unconfirmed` / `pod_confirmed`); a
  **fulfilment did not finish** chip appears when `processed_at` is still
  empty two minutes after the order was created. Refresh sends the shipped
  email when it is the move to `shipped`; `/api/admin/orders/[id]` has
  `maxDuration` 60. `AdminClient.tsx`: Connected services shows Printful as
  connected / token only / not yet, plus a Print files line; `/api/admin/status`
  gained the fields behind it. New event types: `admin_fulfil`, `pod_confirmed`,
  `pod_confirm_failed`, `pod_refreshed`, `pod_refresh_failed`.
- `src/app/api/webhooks/pod/route.ts`: the shipped email is sent on the
  transition to `shipped`, whichever event carried it (`order_updated` with
  status `fulfilled`, or `package_shipped`), never twice.

**Verify harness**: `scripts/verify-commerce.mjs` + `scripts/commerce-mocks.mjs`
(`npm run verify:commerce`): mock Stripe, Supabase (PostgREST), Printful and
Printify on 127.0.0.1 drive the real production build (ports 3202 and 3203)
with every commerce variable set explicitly, so `.env.local` never reaches a
run. It rebuilds `.next` when anything under `src/` is newer than
`.next/BUILD_ID` (`-- --no-build` skips, `-- --build` forces); results in
`.verify/commerce-results.json` and `.verify/commerce-site-*.log`.

**Docs**: `src/lib/commerce/README.md`, `docs/GO-LIVE.md`, `docs/ROADMAP.md`
(Phase 6), `docs/ARCHITECTURE.md`, `.env.example`, the root `README.md`, this
file.

## What was proven, and how

- **Live, read-only, with the real token**: `node scripts/printful.mjs
  status` (token scopes, `/stores` = none, the exact "no store id yet"
  message); `catalog` (all ten variants found, UK `in_stock`, prices below;
  exit 0); `selftest` (48 checks). Store-dependent commands stop cleanly with
  the no-store message, exit 1. `.env.local` was read only by these scripts.
- **Printful API facts** read from developers.printful.com on 5 Oct: order
  item fields, the `confirm` endpoint, `GET /orders/@external_id`, the status
  enum (including `inreview`, which is new), shipment fields, webhook body and
  event types, 120 calls/min with `Retry-After`, the 32-character
  `external_id` rule. Printify facts from its openapi.json.
- **Adapters against an in-process mock of api.printful.com** (22 checks):
  exact request bodies for sync and catalog items; draft → confirm with the
  right headers; confirm failure keeps the draft and does not throw;
  `PRINTFUL_CONFIRM=0` makes one call; POST failure + existing order →
  recovered id; 429 with `Retry-After: 1` → waited and retried exactly once;
  webhook secret missing or wrong → rejected; another store's body → ignored.
  Printify: the same set, plus the HMAC check. Provider selection: demo with
  token only, Printful with token + store, a changed store id or API URL →
  a new provider instance.
- **The whole money path in the production build**: `npm run verify:commerce`
  passes, 59 checks: checkout → Stripe session parameters → a signed
  `checkout.session.completed` → order rows and events → Printful draft and
  confirm (a catalog item with print files, then a store-id item) → duplicate
  delivery → provider 500 (`pod_failed`) → 429 and retry → 500 after the
  provider stored the order (recovery by `@external_id`) → Printful webhooks
  (secret, store id, `package_shipped`, no status regression) → the success
  page; then the same for Printify (mapping, an unmapped variant, the HMAC
  webhook).
- **CLI against a local mock**: `printfiles`, `products sync --dry-run`
  (bodies, nothing written), sync create (POST ×3 → `pod-ids.json` with ten
  variants), sync again (PUT ×3, identical ids), webhooks register / list /
  clear (secret masked in output, full secret received by the mock; http
  refused), orders list / get / confirm / cancel (`--yes` required),
  `pod-ids.mjs --write` and three `--map` error cases. `pod-ids.json` was
  restored byte-identical afterwards.
- **Print files**: read back with sharp: sizes as above, alpha present, the
  opaque colour set exactly the five threads (embroidery) or black only (ink,
  flyer); viewed on the cap's black and on white. `merch-textures.mjs` output
  unchanged (sha256 before and after).
- **Database**: migration applied twice without error; `schema_migrations`
  row matches the file (md5); `node scripts/db.mjs supabase/tests/rls-smoke.sql`
  ends with `RLS smoke test passed`; the Supabase advisor shows only the
  expected findings for the new tables.
- **Admin routes**: on a dev server all five admin endpoints answer 401 JSON
  without a token and with a bogus one; `/admin?demo=1` renders the card with
  "Demo mode: no orders." and makes no request; no horizontal overflow at
  375×812. The success paths (listing, the three actions) are typecheck-
  and code-verified only: `.env.local` has no service-role key and no admin
  session was available.
- **Whole repo**: `npm run typecheck` exits 0; `npx eslint` is clean on every
  touched source file; all written text files are LF.

## Costs (Printful catalog, USD, read 5 Oct 2026)

| Product | Printful base | Extras | Kitty price |
|---|---|---|---|
| Kitty Cap (Yupoong 6245CM, embroidered front) | 17.95 | none | £28 |
| Kitty Hoodie (Gildan 18500, left-chest embroidery) | 24.25 | +2.95 embroidery | £55 |
| Missing Poster Long-Sleeve (Bella + Canvas 3501, DTG) | 18.75 | +5.95 back, +5.95 sleeve | £38 |
| Shipping | UK rate per order, on top (`printfiles` and the first draft show it) | | £3.99 flat |

Plus Stripe's 1.5% + 20p on the GBP charge. The long-sleeve has the thinnest
margin: about $30.65 base before shipping against £38.

## Open questions for you

1. **Cap thread colours.** The blueprint sends the generic `thread_colors`
   option for the cap's front embroidery (Printful's docs use that id for the
   default placement), but the live catalog lists only `thread_colors_3d`,
   `thread_colors_front_large`, `thread_colors_back/right/left`,
   `embroidery_type`, `notes` and `license_type` for product 206. `catalog`
   prints a WARN, not a failure. `printfiles` (needs the store) lists the
   option ids Printful accepts; if a sync or order is rejected on it, drop the
   `thread_colors` line from the cap's `options` in `src/config/printful.ts`
   (the file is already exactly the five threads, so the digitisers match them
   from it) or rename it to the id `printfiles` shows.
2. **The long-sleeve copy.** `src/config/products.ts` says "Organic cotton
   long-sleeve … screen-printed". Printful UK has no organic long-sleeve in
   stock; Bella + Canvas 3501 is combed ring-spun cotton, and the print is
   Kornit water-based DTG, not a screen print. Either change the words or pick
   another blueprint (the research note still lists a pre-order batch with
   3rd Rail Clothing, SE16, as the true screen-print route).
3. **Product images.** `public/products/cap-front.png`, `hoodie-front.png`,
   `hoodie-back.png`, `longsleeve-front.png`, `longsleeve-back.png` are
   referenced by `products.ts` (the store cards and Stripe's line images) and
   do not exist. Printful's mockups after `products sync` are one source.
4. **`PRINTFUL_CONFIRM`.** `0` means every order waits as a draft (the `/admin`
   row says **draft: not confirmed**) until you press Confirm at Printful
   there or run `node scripts/printful.mjs orders confirm <id> --yes` (a look
   before money leaves; both charge the Printful card). `1` means hands-off.
   Both work; start with `0` for the first few.
5. **Vercel Pro and Supabase Pro** before the first real sale. The webhook
   endpoint also benefits: Hobby functions have shorter limits.

## Caveats

- Nothing store-side has been run for real: the mocks verified the request and
  response flow and idempotency, not Printful's validation of file URLs,
  option values or `retail_price`. Step 4's `--dry-run` then `products sync`
  is the true check.
- `external_id` deviates from the first draft of the contract on purpose (the
  32-character rule above). A harness asserting it equals the Stripe session
  id holds only for ids that fit.
- The exact response of `POST /orders/{id}/confirm` and the per-event contents
  of webhook `data` beyond `package_shipped` and `order_updated` could not be
  read from the docs; the code tolerates any shape and unknown events are
  logged, never acted on.
- `Retry-After` is parsed as seconds only (what Printful sends) and capped at
  5 s; one retry per call, so a sustained 429 becomes `pod_failed`, the claim
  is released, and the admin resubmits.
- `npm run verify:commerce` proves the flow against mocks, not against
  Printful's own validation of file URLs, option values or `retail_price`;
  its env overrides (`STRIPE_API_BASE`, `PRINTFUL_API_URL`,
  `PRINTIFY_API_URL`, `POD_IDS_JSON`) are ignored in production unless they
  point at this machine, so a stray copy in Vercel cannot redirect real
  traffic (`/api/admin/status` → `overrides` would still show it).
- Printful's v2 API is still Open Beta and its docs say v1 "may be phased out";
  the adapter is one file, so the move is contained.
- Order emails need Resend and a verified domain (Phase 5); until then
  confirmation and shipped emails are logged, not sent.
