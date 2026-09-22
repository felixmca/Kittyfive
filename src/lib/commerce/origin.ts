/**
 * Where Stripe should send the customer back to. NEXT_PUBLIC_SITE_URL wins
 * when set (so preview deployments can pin production); otherwise the proxy
 * headers Vercel sets; otherwise the request URL itself.
 */
export function resolveOrigin(req: Request): string {
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
