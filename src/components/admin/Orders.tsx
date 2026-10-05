"use client";
/**
 * Orders on /admin: the newest orders, what is in them, where each one is
 * with the maker, and the three hands-on moves (send to the maker, confirm
 * at the maker, refresh from the maker) for the orders that need them.
 *
 * Reads /api/admin/orders with the signed-in admin's bearer token; actions
 * POST to /api/admin/orders/[id]. Live mode only: demo mode has no orders
 * and makes no request. Mobile-first: one stacked row per order, buttons
 * large enough for a thumb.
 */
import { useCallback, useEffect, useState } from "react";
import { accessToken } from "@/lib/auth/store";
import { formatPence } from "@/lib/commerce/format";
import type { AdminOrderSummary } from "@/lib/commerce/orders";
import type { OrderStatus } from "@/lib/commerce/types";

type Action = "fulfil" | "confirm" | "refresh";

interface Provider {
  name: string;
  canConfirm: boolean;
  canRefresh: boolean;
}

interface Note {
  ok: boolean;
  text: string;
}

const LIMIT = 30;

const STATUS_CHIP: Record<OrderStatus, { label: string; className: string }> = {
  paid: { label: "paid", className: "border-amber-300/40 bg-amber-300/10 text-amber-200" },
  submitted: { label: "submitted", className: "border-sky-300/40 bg-sky-300/10 text-sky-200" },
  in_production: { label: "in production", className: "border-violet-300/40 bg-violet-300/10 text-violet-200" },
  shipped: { label: "shipped", className: "border-emerald-300/40 bg-emerald-300/10 text-emerald-200" },
  delivered: { label: "delivered", className: "border-emerald-300/60 bg-emerald-300/20 text-emerald-100" },
  cancelled: { label: "cancelled", className: "border-white/20 bg-white/[0.06] text-muted" },
  failed: { label: "failed", className: "border-[#ff9b8a]/50 bg-[#ff9b8a]/10 text-[#ff9b8a]" },
};

const PROVIDER_LABEL: Record<string, string> = { printful: "Printful", printify: "Printify", demo: "demo maker" };

const BUTTON =
  "min-h-[44px] rounded-full border border-white/15 bg-white/[0.05] px-4 text-[14px] text-fg transition-colors hover:border-accent/60 disabled:cursor-wait disabled:opacity-50";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const providerName = (name: string | null) => (name ? (PROVIDER_LABEL[name] ?? name) : null);

/** After this long with processed_at still empty, the webhook's deferred fulfilment did not finish. */
const STALLED_AFTER_MS = 120_000;
const stalled = (o: AdminOrderSummary) => !o.processedAt && Date.now() - Date.parse(o.createdAt) > STALLED_AFTER_MS;

function itemsLine(items: AdminOrderSummary["items"]): string {
  return items
    .map((i) => `${i.name}${i.variantLabel ? ` · ${i.variantLabel}` : ""} ×${i.quantity}`)
    .join(", ");
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** `live`: the auth store's mode (the card renders only after its admin check, in the browser). */
export default function Orders({ live }: { live: boolean }) {
  const [rows, setRows] = useState<AdminOrderSummary[] | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Record<string, Action>>({});
  const [notes, setNotes] = useState<Record<string, Note>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders?limit=${LIMIT}`, { headers: await authHeaders(), cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { orders?: AdminOrderSummary[]; provider?: Provider; error?: string };
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setRows(json.orders ?? []);
      setProvider(json.provider ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!live) return;
    void load();
  }, [live, load]);

  async function act(id: string, action: Action) {
    setPending((p) => ({ ...p, [id]: action }));
    setNotes((n) => {
      const next = { ...n };
      delete next[id];
      return next;
    });
    try {
      const res = await fetch(`/api/admin/orders/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json().catch(() => ({}))) as { order?: AdminOrderSummary; message?: string; error?: string };
      if (!res.ok || !json.order) {
        setNotes((n) => ({ ...n, [id]: { ok: false, text: json.error ?? `HTTP ${res.status}` } }));
        return;
      }
      const updated = json.order;
      setRows((r) => (r ? r.map((o) => (o.id === id ? updated : o)) : r));
      setNotes((n) => ({ ...n, [id]: { ok: true, text: json.message ?? "Done." } }));
    } catch (e) {
      setNotes((n) => ({ ...n, [id]: { ok: false, text: e instanceof Error ? e.message : "Could not reach the server." } }));
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
  }

  if (!live) return <p className="text-[14px] text-muted" data-admin-orders="demo">Demo mode: no orders.</p>;

  const reload = (
    <button
      type="button"
      onClick={() => void load()}
      disabled={loading}
      className="text-[14px] text-accent underline-offset-4 hover:underline disabled:opacity-50"
      data-admin-orders-reload
    >
      {loading ? "Reloading…" : "Reload"}
    </button>
  );

  if (error) {
    return (
      <div data-admin-orders="error">
        <p className="text-[14px] text-[#ff9b8a]">Could not read the orders: {error}</p>
        <div className="mt-2">{reload}</div>
      </div>
    );
  }
  if (!rows) return <p className="text-[14px] text-muted" data-admin-orders="loading">Reading…</p>;
  if (!rows.length) {
    return (
      <div data-admin-orders="empty">
        <p className="text-[14px] text-muted">No orders yet. Kitty is watching the door.</p>
        <div className="mt-2">{reload}</div>
      </div>
    );
  }

  return (
    <div data-admin-orders="list">
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <p className="text-fg/85">
          The last {rows.length} order{rows.length === 1 ? "" : "s"}, newest first.
          {provider && provider.name !== "demo" ? ` Maker: ${providerName(provider.name)}.` : " No maker configured yet."}
        </p>
        {reload}
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-white/8 text-[13px]">
        {rows.map((o) => {
          const chip = STATUS_CHIP[o.status] ?? STATUS_CHIP.paid;
          const busy = pending[o.id];
          const note = notes[o.id];
          const atProvider = Boolean(o.podOrderId) && (!o.podProvider || o.podProvider === provider?.name);
          const canFulfil = o.kind === "merch" && o.status === "paid" && !o.podOrderId;
          // Confirm only means something for a draft the maker has not started.
          const canConfirm = atProvider && o.status === "submitted" && o.needsConfirm && Boolean(provider?.canConfirm);
          const canRefresh = atProvider && Boolean(provider?.canRefresh);
          const maker = providerName(o.podProvider);
          return (
            <li key={o.id} className="flex flex-col gap-1.5 py-3" data-admin-order={o.id} data-order-status={o.status}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-fg/90">
                  <span className="text-muted">{when(o.createdAt)}</span> · {o.kind}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-fg/90">{formatPence(o.amountPence, { currency: o.currency })}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] ${chip.className}`}>
                    {chip.label}
                  </span>
                  {o.needsConfirm ? (
                    <span
                      className="rounded-full border border-[#ff9b8a]/60 bg-[#ff9b8a]/15 px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-[#ff9b8a]"
                      data-order-draft
                    >
                      draft: not confirmed
                    </span>
                  ) : null}
                  {stalled(o) ? (
                    <span
                      className="rounded-full border border-amber-300/50 bg-amber-300/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-amber-200"
                      data-order-stalled
                      title="The payment webhook never finished this order (no processed_at)."
                    >
                      fulfilment did not finish
                    </span>
                  ) : null}
                </span>
              </div>
              <span className="text-fg/85">{itemsLine(o.items) || "(no items recorded)"}</span>
              <span className="break-words text-muted">
                {o.podOrderId ? `${maker ?? "maker"} #${o.podOrderId}` : "not with the maker yet"}
                {o.tracking?.number ? ` · ${o.tracking.carrier ? `${o.tracking.carrier} ` : ""}${o.tracking.number}` : ""}
                {o.lastEvent ? ` · last: ${o.lastEvent.type}` : ""}
                {o.email ? ` · ${o.email}` : ""}
              </span>
              {canFulfil || canConfirm || canRefresh ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  {canFulfil ? (
                    <button type="button" className={BUTTON} disabled={Boolean(busy)} onClick={() => void act(o.id, "fulfil")} data-order-action="fulfil">
                      {busy === "fulfil" ? "Sending…" : "Send to the maker"}
                    </button>
                  ) : null}
                  {canConfirm ? (
                    <button type="button" className={BUTTON} disabled={Boolean(busy)} onClick={() => void act(o.id, "confirm")} data-order-action="confirm">
                      {busy === "confirm" ? "Confirming…" : provider?.name === "printful" ? "Confirm at Printful" : "Send to production"}
                    </button>
                  ) : null}
                  {canRefresh ? (
                    <button type="button" className={BUTTON} disabled={Boolean(busy)} onClick={() => void act(o.id, "refresh")} data-order-action="refresh">
                      {busy === "refresh" ? "Asking…" : "Refresh from the maker"}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {note ? (
                <p className={`break-words text-[13px] ${note.ok ? "text-emerald-300" : "text-[#ff9b8a]"}`} data-order-note>
                  {note.text}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
