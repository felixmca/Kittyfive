/**
 * GET /api/admin/status: which services this deployment has keys for.
 * Admins only (bearer token → is_admin()). Returns presence booleans, never
 * values.
 */
import { bearerToken, serverSupabaseAs } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const has = (name: string) => Boolean(process.env[name]?.trim());

export async function GET(req: Request): Promise<Response> {
  const token = bearerToken(req);
  const caller = token ? await serverSupabaseAs(token) : null;
  if (!caller) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { data: isAdmin, error } = await caller.sb.rpc("is_admin");
  if (error || isAdmin !== true) return Response.json({ error: "Admins only." }, { status: 403 });

  return Response.json(
    {
      supabase: supabaseConfigured,
      anthropic: has("ANTHROPIC_API_KEY"),
      stripe: has("STRIPE_SECRET_KEY") && has("STRIPE_WEBHOOK_SECRET"),
      printful: has("PRINTFUL_API_TOKEN") && has("PRINTFUL_STORE_ID"),
      resend: has("RESEND_API_KEY"),
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
