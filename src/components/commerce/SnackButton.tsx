"use client";
/**
 * "Give Kitty a snack · £1". POSTs /api/snack and follows the returned
 * Checkout URL (a demo URL when unconfigured). Real money, no play economy.
 */
import { useState } from "react";
import { SNACK } from "@/config/products";
import { formatPence } from "@/lib/commerce/format";
import { useUi } from "@/lib/store";

export default function SnackButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const showToast = useUi((s) => s.showToast);

  async function giveSnack() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/snack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error || "Could not open the snack tin.");
      window.location.assign(json.url);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={giveSnack}
      disabled={busy}
      aria-busy={busy}
      className={`glass inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 text-sm font-medium text-fg transition-opacity active:opacity-80 disabled:opacity-60 ${className}`}
    >
      <span aria-hidden className="text-accent">
        ●
      </span>
      {busy ? "One moment…" : `${SNACK.label} · ${formatPence(SNACK.pricePence, { compact: true })}`}
    </button>
  );
}
