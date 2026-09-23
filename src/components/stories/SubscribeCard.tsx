"use client";
/**
 * "New chapters by email" for readers (Phase 5): on /stories and at the end
 * of the chapter reader. Signed in (with a confirmed email) it is one press
 * to subscribe or stop; signed out it points to the account page. Demo mode
 * keeps it in this browser and says so.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { SITE } from "@/config/site";
import { useAuth } from "@/lib/auth/store";
import { liveMode } from "@/lib/supabase/browser";
import { mySubscription, subscribe, unsubscribe, type SubStatus } from "@/lib/subscriptions/client";

export default function SubscribeCard({ petId, petName, className = "" }: { petId: string; petName: string; className?: string }) {
  const auth = useAuth();
  const [status, setStatus] = useState<SubStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Read after mount: the server cannot know (demo mode is a browser setting),
  // and the first render must match its HTML.
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    auth.init();
    setDemo(!liveMode());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!auth.ready) return;
    let cancelled = false;
    mySubscription(petId, auth.user?.id ?? null)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.ready, auth.user?.id, petId]);

  const on = status === "active";
  const signedIn = demo || Boolean(auth.user);
  const known = status !== undefined;

  async function toggle() {
    setBusy(true);
    setNote(null);
    try {
      const next = on ? await unsubscribe(petId) : await subscribe(petId);
      setStatus(next);
      setNote(
        next === "active"
          ? `Done. ${petName}'s next chapter comes to ${demo ? "you (demo: nothing is really sent)" : auth.user?.email ?? "your inbox"}.`
          : "Stopped. No more emails.",
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`glass rounded-[24px] px-5 py-5 sm:px-6 ${className}`}
      aria-labelledby="subscribe-heading"
      data-subscribe={status === undefined ? "loading" : on ? "on" : "off"}
    >
      <h2 id="subscribe-heading" className="font-display text-[24px] font-light leading-tight text-fg">
        {on ? `You get ${petName}'s new chapters` : `${petName}'s new chapters, by email`}
      </h2>
      <p className="mt-2 max-w-[48ch] text-[14px] leading-relaxed text-muted">
        {on
          ? "One email when a chapter comes out. Nothing else, and you can stop whenever you like."
          : "One email when a chapter comes out: its picture, its title, a link. Nothing else."}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!known ? (
          <span className="inline-flex h-11 items-center text-[14px] text-muted">One moment…</span>
        ) : signedIn ? (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            data-subscribe-toggle
            className={
              on
                ? "inline-flex h-11 items-center rounded-full border border-white/15 px-5 text-[15px] text-fg transition-colors hover:border-white/35 disabled:opacity-50"
                : "inline-flex h-11 items-center rounded-full bg-accent px-5 text-[15px] font-medium text-[#141414] transition-opacity hover:opacity-90 disabled:opacity-50"
            }
          >
            {busy ? "One moment…" : on ? "Stop the emails" : "Email me new chapters"}
          </button>
        ) : (
          <Link
            href={SITE.nav.account.href}
            className="inline-flex h-11 items-center rounded-full bg-accent px-5 text-[15px] font-medium text-[#141414] transition-opacity hover:opacity-90"
            data-subscribe-signin
          >
            Sign in to get them
          </Link>
        )}
      </div>
      {note ? (
        <p className="mt-3 text-[13px] leading-relaxed text-fg/80" role="status" data-subscribe-note>
          {note}
        </p>
      ) : null}
    </section>
  );
}
