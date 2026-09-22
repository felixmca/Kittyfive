"use client";
/**
 * /store composition: chrome + demo banner (other slices), the full-viewport
 * living room, prev/next arrows, the product sheet and the chat dock. The 3D
 * scene is client-only (ssr:false) because it touches window and canvas.
 */
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import Chrome from "@/components/chrome/Chrome";
import DemoBanner from "@/components/commerce/DemoBanner";
import ChatDock from "@/components/chat/ChatDock";
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
      <Chrome />

      <div className="absolute inset-0">
        <StoreScene />
      </div>

      <header className="pointer-events-none absolute left-4 top-[calc(env(safe-area-inset-top)+3.25rem)] z-10 max-w-[60%]">
        <h1 className="font-display text-2xl leading-none">Kitty Store</h1>
        <p className="mt-1 text-xs text-muted">Tap the arrows. Kitty will show you round.</p>
      </header>

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
