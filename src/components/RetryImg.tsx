"use client";
/**
 * An <img> that tries twice, then gets out of the way.
 *
 * iOS Safari draws a "?" box for a picture that failed, even with alt="";
 * Chrome draws nothing, so a failure there goes unseen. A failure also
 * sticks: Safari keeps a failed response (a dropped connection on a weak
 * signal, or a "not found" cached before the file existed) and shows the "?"
 * again on every visit. So a failed picture is asked for once more under a
 * fresh address, which no cache has seen, and if that fails too the element
 * is removed and whatever is underneath (a gradient, another picture) shows.
 *
 * A server-rendered picture can fail before React is listening (the browser
 * starts fetching as soon as the HTML arrives), and then onError never fires.
 * So on mount the element is asked whether it already broke.
 */
import { useCallback, useEffect, useRef, useState, type ComponentPropsWithRef } from "react";

type Props = Omit<ComponentPropsWithRef<"img">, "src" | "onError"> & {
  src: string;
  /** Called once, when the second attempt has failed too. */
  onGiveUp?: () => void;
};

/** The same picture under an address no cache has seen, or null for inline data. */
export function retryUrl(src: string): string | null {
  if (/^(data|blob):/.test(src)) return null;
  return `${src}${src.includes("?") ? "&" : "?"}retry=1`;
}

export default function RetryImg({ src, onGiveUp, alt = "", ref, ...rest }: Props) {
  const [tries, setTries] = useState({ src, n: 0 });
  const n = tries.src === src ? tries.n : 0;
  const url = n === 0 ? src : n === 1 ? retryUrl(src) : null;
  const el = useRef<HTMLImageElement | null>(null);
  const giveUp = useRef(onGiveUp);
  useEffect(() => {
    giveUp.current = onGiveUp;
  }, [onGiveUp]);

  const fail = useCallback(() => {
    setTries((t) => {
      const at = t.src === src ? t.n : 0;
      if (at >= 2) return t;
      return { src, n: at === 0 && retryUrl(src) ? 1 : 2 };
    });
  }, [src]);

  const gaveUp = n >= 2;
  useEffect(() => {
    if (gaveUp) giveUp.current?.();
  }, [gaveUp]);

  // Broken before hydration: complete with nothing decoded.
  useEffect(() => {
    const img = el.current;
    if (img && img.complete && img.naturalWidth === 0 && img.getAttribute("src")) fail();
  }, [url, fail]);

  const setRef = useCallback(
    (node: HTMLImageElement | null) => {
      el.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...rest} ref={setRef} alt={alt} src={url} onError={fail} />
  );
}
