"use client";
import { useEffect, useState } from "react";

/**
 * HEAD-checks an optional public asset. Returns null while checking, then
 * true/false. A 404 is expected and silent; only a real 200 with a non-HTML
 * content type counts, because some hosts answer unknown paths with the SPA
 * shell and a 200.
 */
export function useAssetExists(url: string | undefined | null): boolean | null {
  const [exists, setExists] = useState<boolean | null>(url ? null : false);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(url, { method: "HEAD", cache: "no-store" })
      .then((res) => {
        if (cancelled) return;
        const type = res.headers.get("content-type") ?? "";
        setExists(res.ok && !type.includes("text/html"));
      })
      .catch(() => {
        if (!cancelled) setExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return exists;
}
