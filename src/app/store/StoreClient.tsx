"use client";
/**
 * /store composition: chrome + demo banner (other slices), the full-viewport
 * living room, prev/next arrows, the product sheet and the chat dock. The 3D
 * scene is client-only (ssr:false) because it touches window and canvas.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import Chrome from "@/components/chrome/Chrome";
import { BELOW_CHROME } from "@/components/chrome/layout";
import { SITE } from "@/config/site";
import DemoBanner from "@/components/commerce/DemoBanner";
import ChatDock from "@/components/chat/ChatDock";
import LightToggle from "@/components/store/LightToggle";
import ProductPanel, { ProductArrows } from "@/components/store/ProductPanel";
import ScenePlaceholder from "@/components/store/ScenePlaceholder";
import { useUi } from "@/lib/store";

const StoreScene = dynamic(() => import("@/components/store/StoreScene"), {
  ssr: false,
  loading: () => <ScenePlaceholder variant="loading" />,
});

export default function StoreClient() {
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <DemoBanner />
      {/* The product panel has its own "Try it on"; a floating camera would sit on it. */}
      <Chrome hideCamera />

      {/* The room is the page's main content (screen readers get the header, the arrows and the panel around it). */}
      <main className="absolute inset-0" aria-label="Kitty's living room">
        <StoreScene />
      </main>

      {/* A soft shade under the chrome row and the heading, so both read over a bright room. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-[240px] bg-gradient-to-b from-black/65 via-black/35 to-transparent"
      />

      <header
        className="absolute left-4 z-10 max-w-[70%]"
        // Below the chrome row (Kitty's home button, the demo pill, the menu).
        style={{ top: BELOW_CHROME }}
      >
        <h1 className="font-display pointer-events-none text-2xl leading-none [text-shadow:0_1px_12px_rgba(0,0,0,0.55)]">
          Kitty Store
        </h1>
        <p className="pointer-events-none mt-1 text-xs text-fg/80 [text-shadow:0_1px_8px_rgba(0,0,0,0.6)]">
          Tap the arrows. Kitty will show you round.
        </p>
        <Link
          href={SITE.nav.stories.href}
          className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full text-xs font-medium text-accent underline-offset-4 hover:underline"
        >
          Read her stories
          <span aria-hidden>→</span>
        </Link>
      </header>

      <LightToggle />
      <ProductArrows />

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-md flex-col items-stretch gap-2">
          <ChatDock />
          <ProductPanel />
        </div>
      </div>

      <Suspense fallback={null}>
        <ReturnMessages />
      </Suspense>
      <Toast />
    </div>
  );
}

/** Stripe sends people back here after a snack or a cancelled checkout. */
function ReturnMessages() {
  const params = useSearchParams();
  const showToast = useUi((s) => s.showToast);
  const snack = params.get("snack");
  const cancelled = params.get("cancelled");
  useEffect(() => {
    if (snack === "thanks") showToast("Snack received. Kitty says: acceptable.", 4500);
    else if (cancelled) showToast("No charge. Kitty was not bothered either way.", 3200);
    if (snack || cancelled) window.history.replaceState(null, "", "/store");
  }, [snack, cancelled, showToast]);
  return null;
}

function Toast() {
  const toast = useUi((s) => s.toast);
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+5.5rem)] z-50 -translate-x-1/2 transition-opacity duration-200 ${
        toast ? "opacity-100" : "opacity-0"
      }`}
    >
      {toast && <div className="glass max-w-[85vw] rounded-full px-4 py-2 text-sm text-fg">{toast}</div>}
    </div>
  );
}
