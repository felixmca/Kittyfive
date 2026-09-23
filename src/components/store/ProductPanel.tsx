"use client";
/**
 * Bottom sheet for the current product plus the prev/next arrows.
 *
 * The sheet always shows a compact row (name, price, method) that toggles the
 * full details: description, variant pills, the Buy button, which POSTs to
 * /api/checkout and follows the returned Stripe URL, and "Try it on", which
 * opens the camera try-on on the same product (productIndex is shared).
 */
import Link from "next/link";
import { useState } from "react";
import { PRODUCTS, SHIPPING } from "@/config/products";
import { useUi } from "@/lib/store";
import { wrapIndex } from "./spots";
import { selectedVariant, useStoreState } from "./storeState";

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function formatPence(pence: number): string {
  return gbp.format(pence / 100);
}

const METHOD_LABEL: Record<(typeof PRODUCTS)[number]["method"], string> = {
  embroidery: "embroidered",
  "screen-print": "screen-printed",
};

export function ProductArrows() {
  const productIndex = useUi((s) => s.productIndex);
  const setProductIndex = useUi((s) => s.setProductIndex);
  const go = (delta: number) => setProductIndex(wrapIndex(productIndex + delta, PRODUCTS.length));

  const cls =
    "glass fixed top-1/2 z-20 grid h-[52px] w-[52px] -translate-y-1/2 place-items-center rounded-full text-fg transition-transform active:scale-95";
  return (
    <>
      <button type="button" aria-label="Previous product" onClick={() => go(-1)} className={`${cls} left-3`}>
        <Chevron dir="left" />
      </button>
      <button type="button" aria-label="Next product" onClick={() => go(1)} className={`${cls} right-3`}>
        <Chevron dir="right" />
      </button>
    </>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: dir === "left" ? "scaleX(-1)" : undefined }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export default function ProductPanel() {
  const productIndex = useUi((s) => s.productIndex);
  const showToast = useUi((s) => s.showToast);
  const setChatOpen = useUi((s) => s.setChatOpen);
  const open = useStoreState((s) => s.panelOpen);
  const setOpen = useStoreState((s) => s.setPanelOpen);
  const variants = useStoreState((s) => s.variants);
  const selectVariant = useStoreState((s) => s.selectVariant);
  const [buying, setBuying] = useState(false);

  const index = wrapIndex(productIndex, PRODUCTS.length);
  const product = PRODUCTS[index];
  const variant = selectedVariant(product, variants);
  const price = formatPence(product.pricePence);

  async function buy() {
    if (!variant || buying) return;
    setBuying(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId: variant.id, quantity: 1 }),
      });
      let data: { url?: unknown; error?: unknown } = {};
      try {
        data = (await res.json()) as { url?: unknown; error?: unknown };
      } catch {
        /* not JSON; handled below */
      }
      if (typeof data.url === "string" && data.url) {
        window.location.href = data.url;
        return;
      }
      showToast(
        typeof data.error === "string" && data.error
          ? data.error
          : "Checkout did not answer. Try again in a moment.",
      );
    } catch {
      showToast("Checkout is having a nap. Try again in a moment.");
    } finally {
      setBuying(false);
    }
  }

  return (
    <section aria-label="Product" className="pointer-events-auto glass overflow-hidden rounded-3xl text-fg">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="product-details"
        onClick={() => {
          setOpen(!open);
          if (!open) setChatOpen(false);
        }}
        className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate font-display text-lg leading-tight">{product.name}</span>
          <span className="mt-0.5 block text-sm text-muted">
            {price} · {METHOD_LABEL[product.method]}
          </span>
        </span>
        <span className="shrink-0 text-sm font-medium text-accent">{open ? "Close" : "Details"}</span>
      </button>

      {open && (
        <div
          id="product-details"
          data-lenis-prevent
          className="max-h-[52dvh] space-y-4 overflow-y-auto overscroll-contain px-4 pb-4"
        >
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-accent/50 px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-accent">
              {METHOD_LABEL[product.method]}
            </span>
            <span className="text-xs text-muted">
              {index + 1} of {PRODUCTS.length}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-fg/85">{product.description}</p>

          <div
            role="radiogroup"
            aria-label={product.variants.some((v) => v.size) ? "Colour and size" : "Colour"}
            className="flex flex-wrap gap-2"
          >
            {product.variants.map((v) => {
              const selected = v.id === variant.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => selectVariant(product.id, v.id)}
                  className={`flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm transition-colors ${
                    selected ? "bg-fg text-bg" : "glass text-fg"
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 rounded-full border border-white/30"
                    style={{ background: v.colour }}
                  />
                  {v.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={buy}
            disabled={buying}
            aria-busy={buying}
            className="min-h-[56px] w-full rounded-2xl bg-accent px-4 text-base font-semibold text-bg transition-transform active:scale-[0.99] disabled:opacity-70"
          >
            {buying ? "One moment…" : `Buy · ${price}`}
          </button>
          <Link
            href="/try-on"
            className="glass flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-medium text-fg transition-transform active:scale-[0.99]"
          >
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="2.5" y="7" width="19" height="13" rx="3" stroke="currentColor" strokeWidth="1.6" />
              <path d="M8 7V5.6A1.6 1.6 0 0 1 9.6 4h4.8A1.6 1.6 0 0 1 16 5.6V7" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="12" cy="13.5" r="3.6" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            Try it on with your camera
          </Link>
          <p className="text-center text-xs text-muted">
            UK shipping {formatPence(SHIPPING.ukPence)}, added at checkout.
          </p>
        </div>
      )}
    </section>
  );
}
