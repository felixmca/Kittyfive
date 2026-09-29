# Payment fees — where the £3.10 went, and how to keep it

*Written 29 Sep 2026. Every rate below carries the source URL it came from and
the date it was read. The arithmetic is worked in full so you can check it.*

---

## Your question

> "The last payment I accepted was £20 but I only received £16.90."

£20.00 in, £16.90 out. That is **£3.10 gone, or 15.5%.** That number is the whole
story, because **no direct card processor charges anything close to it.** 15.5% is
a *marketplace* fee, not a *payment* fee.

---

## First, prove it was not Stripe

Stripe UK, standard pay-as-you-go pricing (no monthly fee), rates as published for
2026:

| Card the buyer used | Stripe rate | Fee on £20 | You keep |
|---|---|---|---|
| **UK card** | 1.5% + 20p | **£0.50** | **£19.50** |
| Premium UK card (some rewards cards) | 1.9% + 20p | £0.58 | £19.42 |
| EEA card | 2.5% + 20p | £0.70 | £19.30 |
| International card | 3.25% + 20p | £0.85 | £19.15 |
| International + currency conversion | 3.25% + 20p + 2% | £1.25 | £18.75 |

Sources: Stripe GB pricing page (https://stripe.com/gb/pricing) and the
independently compiled tables at
https://merchanthq.co.uk/fees/stripe/ and
https://www.wearefounders.uk/stripe-fees-uk-2026/, all read 29 Sep 2026.

**The worst case Stripe can produce on a £20 order — an overseas card that also
triggers currency conversion — is £1.25.** Your £3.10 is two and a half times
that. So whatever took your money, it was not Stripe charging its own rates.

---

## What a 15.5% fee actually is: a marketplace

15.5% is the signature of a **marketplace that stacks several fees on one sale**.
The closest match — near-exact — is **Etsy UK**. Here is Etsy's 2026 fee stack on a
£20 order where the buyer paid £20 all in (item + postage):

| Etsy fee | Rate | On £20 |
|---|---|---|
| Transaction fee | 6.5% of item + postage | £1.30 |
| Payment processing | 4% + £0.20 | £1.00 |
| Regulatory operating fee | ~0.48% | £0.10 |
| Listing fee | ~£0.16 | £0.16 |
| **VAT (20%) on all of the above** | 20% | £0.51 |
| **Total** | | **≈ £3.07** |

Net to you: **£20.00 − £3.07 = £16.93.** You received £16.90. **A three-penny
difference** — that is a fee stack landing on the exact number, not a coincidence.

Etsy fee source: https://www.feeproofed.com/guides/etsy-fees-uk-2026/ and
https://globalfeecalculator.com/blog/etsy-fees-uk-explained/, read 29 Sep 2026
(both give the same 6.5% transaction + 4% + £0.20 processing + VAT-on-fees stack).

> **Honest caveat:** you didn't tell me the platform, so I inferred it from the
> arithmetic. If it wasn't Etsy it was something with an almost identical stack (a
> POD storefront that resells for you, or another craft marketplace). It was **not**
> PayPal (that would be ~£0.88, 4.4%), **not** Gumroad (~£2.50, 12.5%), and **not**
> Stripe. If you can tell me the platform or paste the payout breakdown, I'll
> confirm it to the penny. The recommendation below does not change either way.

---

## "Is there a way to pay less fees via Stripe?" — yes, three ways

### 1. The big one: sell direct through Kitty instead of through a marketplace

Kitty already has a complete, working Stripe Checkout integration (see
`src/lib/commerce/`). Every £20 order it takes from a UK customer costs **£0.50**,
not £3.10.

| Per £20 order | Marketplace (~15.5%) | Kitty direct (Stripe, UK card) | You save |
|---|---|---|---|
| Fee | £3.10 | £0.50 | **£2.60** |
| You keep | £16.90 | £19.50 | |

That is **£2.60 more in your pocket on every £20 order**, or put another way, you
keep 97.5% instead of 84.5%. Over 100 orders that is £260. The marketplace's job
was discovery — bringing you the buyer. Once someone knows Kitty exists, sending
them to your own store instead of the marketplace is the single biggest fee cut
available, and it's already built.

### 2. Kitty's checkout is already configured for Stripe's *lowest* tier

This isn't luck — it's how the code is written. In
`src/lib/commerce/stripe.ts`, `createMerchCheckout()` sets:

- `currency: "gbp"` — you charge in pounds, so there's no currency-conversion fee
  on your side.
- `locale: "en-GB"` and UK-only shipping (`SHIPPING.countries = ["GB"]` in
  `src/config/products.ts`) — you're selling to UK buyers paying with UK cards,
  which is the **1.5% + 20p** tier, the cheapest Stripe offers.

So the integration you already have is sitting on the best-case rate. There's
nothing to fix here; it's worth knowing it's deliberate.

### 3. Watch three specific things once you're live

- **Keep prices in GBP.** The 2% currency-conversion fee only appears when Stripe
  converts. Charging GBP to a UK card never converts.
- **"Adaptive Pricing" is free to you.** If you later switch it on to show foreign
  buyers their local currency, Stripe's 2–4% conversion fee there is **paid by the
  customer, not you** (source:
  https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing,
  read 29 Sep 2026). It doesn't raise your cost — it raises theirs — so it's a
  conversion-rate lever, not a fee you'll eat.
- **The fixed 20p hurts most on small sales.** It's 20% of a £1 snack but only
  1% of a £20 order. It's not worth restructuring your merch over, but it's the
  reason the £1 snack keeps only ~78p — bundle or raise small items if that
  button ever gets popular.

There is **no legitimate way to pay less than 1.5% + 20p** on a standard UK card
through Stripe on the pay-as-you-go plan — that rate is only negotiable at high
volume (Stripe's custom "Enterprise" pricing, which is a conversation for £100k+/yr,
not now). The real saving isn't shaving Stripe; it's not paying the marketplace.

---

## Bottom line

- Your £3.10 fee was a **marketplace** taking 15.5%, almost certainly Etsy. Stripe's
  own worst case on £20 is £1.25, and its normal UK case is **£0.50**.
- Selling the same £20 order **direct through Kitty** keeps **£19.50 instead of
  £16.90** — £2.60 more, every time.
- Kitty's checkout is already coded to sit on Stripe's cheapest tier (GBP, UK
  cards). Nothing to change; go live and route buyers to your own store.
