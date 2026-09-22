import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/config/site";
import { getCommerce } from "@/lib/commerce";
import { demoSummaryForVariant } from "@/lib/commerce/demo";
import { isLive } from "@/lib/commerce/env";
import { formatPence } from "@/lib/commerce/format";
import type { OrderStatus, OrderSummary } from "@/lib/commerce/types";
import DemoBanner from "@/components/commerce/DemoBanner";

export const metadata: Metadata = {
  title: "Thank you",
  description: "Your Kitty order.",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  paid: "Paid. Being written down.",
  submitted: "Paid. Sent to the maker.",
  in_production: "Being made.",
  shipped: "Shipped.",
  delivered: "Delivered.",
  cancelled: "Cancelled.",
  failed: "Payment failed.",
};

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // The demo query string only means something while the backend is in demo
  // mode; on the live site it must not render a fake "order received" page.
  const demo = first(sp.demo) === "1" && !isLive();
  const sessionId = first(sp.session_id);

  let summary: OrderSummary | null = null;
  let lookupFailed = false;
  if (demo) {
    summary = demoSummaryForVariant(first(sp.variant), Number.parseInt(first(sp.qty) ?? "1", 10) || 1);
  } else if (sessionId) {
    try {
      summary = await getCommerce().getOrderForSession(sessionId);
    } catch (err) {
      console.error("[checkout/success] lookup failed:", err);
      lookupFailed = true;
    }
  }

  const isSnack = summary?.kind === "snack";
  const shipping = summary
    ? summary.amountPence - summary.items.reduce((sum, i) => sum + i.unitPence * i.quantity, 0)
    : 0;

  return (
    <main className="relative flex min-h-dvh flex-col bg-bg px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] text-fg">
      <DemoBanner />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6">
        <header className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            {summary ? (isSnack ? "Snack received" : "Order received") : "Checkout"}
          </p>
          <h1 className="font-display text-[2.6rem] font-light leading-[1.05]">
            {summary ? "Thank you." : "Thank you, probably."}
          </h1>
          <p className="text-sm text-muted">
            {summary
              ? isSnack
                ? "One pound, straight to the snack tin."
                : "We will email you when it ships. Embroidery and screen-print take a few days."
              : lookupFailed
                ? "We could not read the order just now. If you paid, it is safe with Stripe and your receipt is in your inbox."
                : "There is no order attached to this page. If you just paid, give it a moment and refresh."}
          </p>
        </header>

        {summary ? (
          <section aria-label="Order summary" className="glass rounded-2xl p-5">
            <ul className="divide-y divide-white/10">
              {summary.items.map((item) => (
                <li key={item.variantId} className="flex items-start justify-between gap-4 py-3 first:pt-0">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    {item.variantLabel ? <p className="text-sm text-muted">{item.variantLabel}</p> : null}
                    <p className="text-sm text-muted">Qty {item.quantity}</p>
                  </div>
                  <p className="shrink-0 tabular-nums">
                    {formatPence(item.unitPence * item.quantity, { currency: summary.currency })}
                  </p>
                </li>
              ))}
              {!isSnack && shipping > 0 ? (
                <li className="flex items-center justify-between gap-4 py-3 text-sm text-muted">
                  <span>UK tracked shipping</span>
                  <span className="tabular-nums">{formatPence(shipping, { currency: summary.currency })}</span>
                </li>
              ) : null}
              <li className="flex items-center justify-between gap-4 pt-3 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatPence(summary.amountPence, { currency: summary.currency })}</span>
              </li>
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-accent/40 px-2.5 py-1 text-accent">
                {STATUS_LABEL[summary.status]}
              </span>
              {summary.pending ? (
                <span className="text-muted">Stripe confirmed it; our notebook is catching up.</span>
              ) : null}
              {summary.demo ? <span className="text-muted">Demo order. No money moved.</span> : null}
            </div>

            {summary.tracking?.number || summary.tracking?.url ? (
              <p className="mt-4 text-sm">
                Tracking{summary.tracking.carrier ? ` (${summary.tracking.carrier})` : ""}:{" "}
                {summary.tracking.url ? (
                  <a
                    className="underline decoration-accent/60 underline-offset-4"
                    href={summary.tracking.url}
                    rel="noreferrer"
                  >
                    {summary.tracking.number ?? "follow the parcel"}
                  </a>
                ) : (
                  summary.tracking.number
                )}
              </p>
            ) : null}

            {summary.email ? <p className="mt-4 text-sm text-muted">Receipt sent to {summary.email}.</p> : null}
            <p className="mt-1 break-all text-[11px] text-muted/70">Ref {summary.sessionId}</p>
          </section>
        ) : null}

        <p className="font-display text-xl italic text-fg/90">
          Kitty says: <span className="text-accent">fine, I suppose.</span>
        </p>

        <nav aria-label="Continue" className="mt-auto grid grid-cols-1 gap-3 pt-4 sm:grid-cols-2">
          <Link
            href={SITE.nav.store.href}
            className="flex min-h-[48px] items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-bg active:opacity-90"
          >
            Back to the store
          </Link>
          <Link
            href="/"
            className="glass flex min-h-[48px] items-center justify-center rounded-full px-6 text-sm font-medium text-fg active:opacity-90"
          >
            Back to Kitty
          </Link>
        </nav>
      </div>
    </main>
  );
}
