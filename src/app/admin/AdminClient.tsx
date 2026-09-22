"use client";
/**
 * /admin: the dashboard for the people who run Kittyfive. The database
 * decides who that is (public.admins + is_admin(), which also requires a
 * confirmed email); this page only reflects it. Non-admins see a polite no.
 *
 * Today: what is connected, Kitty's book at a glance, and the setup steps
 * that only the dashboard owner can do. Kitty Tunables (her chat
 * personality) arrive with the store in Phase 3.
 */
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import Chrome from "@/components/chrome/Chrome";
import { SITE } from "@/config/site";
import { accessToken, useAuth } from "@/lib/auth/store";
import { storiesBackend } from "@/lib/stories/client";

interface Status {
  supabase: boolean;
  anthropic: boolean;
  stripe: boolean;
  printful: boolean;
  resend: boolean;
  siteUrl: string | null;
  region: string | null;
}

interface BookCounts {
  volumes: number;
  chapters: number;
  drafts: number;
}

export default function AdminClient() {
  const auth = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [book, setBook] = useState<BookCounts | null>(null);

  useEffect(() => {
    auth.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!auth.ready || !auth.isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const stories = await storiesBackend().loadStories(SITE.petSlug);
        if (stories && !cancelled) {
          const all = stories.volumes.flatMap((v) => v.chapters);
          setBook({ volumes: stories.volumes.length, chapters: all.length, drafts: all.filter((c) => c.status === "draft").length });
        }
      } catch {
        /* the card just stays empty */
      }
      if (auth.mode === "demo") return;
      try {
        const token = await accessToken();
        const res = await fetch("/api/admin/status", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const json = await res.json();
        if (!cancelled) {
          if (res.ok) setStatus(json as Status);
          else setStatusError(json.error ?? `HTTP ${res.status}`);
        }
      } catch (e) {
        if (!cancelled) setStatusError(e instanceof Error ? e.message : "Could not reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.ready, auth.isAdmin, auth.mode]);

  let body: ReactNode;
  if (!auth.ready) body = <p className="text-muted">One moment…</p>;
  else if (!auth.user)
    body = (
      <p className="text-[15px] text-muted">
        <Link href="/account" className="text-accent underline-offset-4 hover:underline">Sign in</Link> with an admin account first.
      </p>
    );
  else if (!auth.isAdmin)
    body = (
      <p className="text-[15px] leading-relaxed text-muted" data-not-admin>
        This page is for the people who run {SITE.name}. You are signed in as {auth.user.email}, which is not one of them.
      </p>
    );
  else
    body = (
      <div className="grid gap-4 sm:grid-cols-2" data-admin-dashboard>
        <Card title={`${SITE.name}'s book`}>
          {book ? (
            <p className="text-[15px] text-fg/90">
              {book.volumes} volumes · {book.chapters} chapters
              {book.drafts ? ` · ${book.drafts} draft${book.drafts === 1 ? "" : "s"}` : ""}
            </p>
          ) : (
            <p className="text-[14px] text-muted">Counting…</p>
          )}
          <Link href="/stories" className="mt-3 inline-block text-[14px] text-accent underline-offset-4 hover:underline">
            Open the Stories page and press Edit →
          </Link>
        </Card>

        <Card title="Kitty Tunables">
          <p className="text-[14px] leading-relaxed text-muted">
            Sliders for Kitty&apos;s chat personality (how dry, how warm, how often she mentions snacks or the merch, how
            long she talks) arrive with the store in Phase 3. Her voice lives in <code className="text-fg/80">src/config/kitty.ts</code> until then.
          </p>
        </Card>

        <Card title="Connected services">
          {auth.mode === "demo" ? (
            <p className="text-[14px] text-muted">Demo mode: nothing is connected.</p>
          ) : status ? (
            <ul className="flex flex-col gap-1.5 text-[14px]">
              <Service ok={status.supabase} name="Supabase (accounts, stories)" />
              <Service ok={status.anthropic} name="Claude (chat, chapter drafts)" />
              <Service ok={status.stripe} name="Stripe (checkout)" later="Phase 6" />
              <Service ok={status.printful} name="Printful (print on demand)" later="Phase 6" />
              <Service ok={status.resend} name="Resend (email)" later="Phase 5" />
            </ul>
          ) : (
            <p className="text-[14px] text-muted">{statusError ?? "Checking…"}</p>
          )}
        </Card>

        <Card title="Only you can do these">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14px] leading-relaxed text-fg/85">
            <li>
              Supabase → Authentication → URL Configuration: Site URL <code>https://kittyfive.vercel.app</code>, Redirect URLs{" "}
              <code>https://kittyfive.vercel.app/**</code> and your localhost ports. Without it, confirmation and reset links
              point at localhost.
            </li>
            <li>Before public sign-ups: send auth email through Resend (the built-in mailer manages about two an hour).</li>
          </ol>
        </Card>
      </div>
    );

  return (
    <>
      <Chrome />
      <main
        className="mx-auto w-full max-w-[920px] px-5 pb-24"
        style={{ paddingTop: "calc(max(12px, env(safe-area-inset-top)) + 84px)" }}
        data-admin
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent">{SITE.name}</p>
        <h1 className="font-display mt-2 text-[40px] font-light leading-[1.05] text-fg">Admin</h1>
        <div className="mt-8">{body}</div>
      </main>
    </>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Service({ ok, name, later }: { ok: boolean; name: string; later?: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-fg/90">{name}</span>
      <span className={ok ? "text-emerald-300" : "text-muted"}>{ok ? "connected" : later ? `not yet (${later})` : "missing"}</span>
    </li>
  );
}
