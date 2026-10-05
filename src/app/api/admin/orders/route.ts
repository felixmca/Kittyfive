/**
 * GET /api/admin/orders?limit=30
 * The newest orders for the /admin Orders card: each with its items, the
 * print provider's id, tracking and the latest audit event. Admins only
 * (bearer token → is_admin(), exactly as /api/admin/status). Never the full
 * address or the phone number.
 *
 * Also says which provider is live and whether it offers confirm / refresh,
 * so the card shows only the buttons that can do something.
 */
import { bearerToken, serverSupabaseAs } from "@/lib/supabase/server";
import { hasSupabase } from "@/lib/commerce/env";
import { listOrders, MAX_ORDER_LIST, toAdminSummary } from "@/lib/commerce/orders";
import { getPod } from "@/lib/commerce/pod";
import { errorMessage, ORDER_STATUSES, type OrderStatus } from "@/lib/commerce/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: Request): Promise<Response> {
  const token = bearerToken(req);
  const caller = token ? await serverSupabaseAs(token) : null;
  if (!caller) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { data: isAdmin, error } = await caller.sb.rpc("is_admin");
  if (error || isAdmin !== true) return Response.json({ error: "Admins only." }, { status: 403 });

  if (!hasSupabase()) {
    return Response.json(
      { error: "Orders live in Supabase, and this deployment has no SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503, ...NO_STORE },
    );
  }

  const url = new URL(req.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isInteger(rawLimit) ? Math.min(MAX_ORDER_LIST, Math.max(1, rawLimit)) : 30;
  const rawStatus = url.searchParams.get("status");
  const status = rawStatus && (ORDER_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as OrderStatus) : undefined;

  try {
    const rows = await listOrders({ limit, status });
    const pod = getPod();
    return Response.json(
      {
        orders: rows.map((row) => toAdminSummary(row.order, row.items, row.lastEvent, row.needsConfirm)),
        provider: {
          name: pod.name,
          canConfirm: typeof pod.confirmOrder === "function",
          canRefresh: typeof pod.getOrder === "function",
        },
      },
      NO_STORE,
    );
  } catch (err) {
    console.error("[admin/orders] list failed:", err);
    return Response.json({ error: errorMessage(err) }, { status: 500, ...NO_STORE });
  }
}
