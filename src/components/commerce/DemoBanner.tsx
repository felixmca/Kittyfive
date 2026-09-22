"use client";
/**
 * A slim fixed pill, top-left, shown only when /api/commerce/status says the
 * site is in DEMO mode (no Stripe/Supabase env). pointer-events-none so it can
 * never steal a tap from the canvas beneath it; stays clear of the top-right
 * 64px where the menu button lives; z-30 sits above any canvas and below the
 * drawer.
 */
import { useEffect, useState } from "react";

let cachedMode: "demo" | "live" | null = null;

export default function DemoBanner() {
  const [demo, setDemo] = useState(cachedMode === "demo");

  useEffect(() => {
    if (cachedMode) {
      setDemo(cachedMode === "demo");
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/commerce/status", { signal: controller.signal, cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { mode?: string };
        cachedMode = json.mode === "demo" ? "demo" : "live";
        setDemo(cachedMode === "demo");
      } catch {
        // Offline, aborted or blocked: say nothing rather than guess.
      }
    })();
    return () => controller.abort();
  }, []);

  if (!demo) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="glass pointer-events-none fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex h-9 max-w-[calc(100vw-96px)] items-center gap-2 rounded-full px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent"
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" />
      <span className="truncate">Demo: no real payments</span>
    </div>
  );
}
