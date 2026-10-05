/**
 * Where Stripe should send the customer back to. A request from localhost
 * always returns to localhost (a local test with NEXT_PUBLIC_SITE_URL set to
 * the live site, which the print-file URLs need, must not land on the live
 * site's success page). Otherwise NEXT_PUBLIC_SITE_URL wins when set (so
 * preview deployments can pin production); otherwise the proxy headers
 * Vercel sets; otherwise the request URL itself.
 */
export function resolveOrigin(req: Request): string {
  const localHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.headers.get("host")?.trim();
  if (localHost && (localHost.startsWith("localhost") || localHost.startsWith("127.") || localHost.startsWith("[::1]"))) {
    const localProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    return `${localProto || "http"}://${localHost}`;
  }
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to headers
    }
  }
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    req.headers.get("host")?.trim();
  if (host) {
    const isLocal = host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("[::1]");
    return `${proto || (isLocal ? "http" : "https")}://${host}`;
  }
  try {
    return new URL(req.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}
