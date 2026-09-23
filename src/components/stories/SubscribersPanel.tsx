"use client";
/**
 * The owner's side of story emails (Phase 5), on /stories for editors:
 *
 *   - who gets the emails (active), who was invited and has not said yes
 *     (pending), and who stopped;
 *   - invite someone by address (they get one email with a Confirm button);
 *   - each published chapter with "Email it", once; emailed ones show when.
 *
 * Until the site can send email (a domain and Resend) it says so and the
 * buttons are off, so a chapter's one send is never used up for nothing.
 * Demo mode does all of it in this browser and sends nothing.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { liveMode } from "@/lib/supabase/browser";
import {
  canSendEmail,
  invite,
  listSubscribers,
  notifiedChapters,
  notifyChapter,
  type Subscriber,
} from "@/lib/subscriptions/client";
import type { PetStories } from "@/lib/stories/types";
import { useUi } from "@/lib/store";

const FIELD =
  "h-11 min-w-0 flex-1 rounded-full border border-white/15 bg-white/[0.04] px-4 text-[16px] text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none sm:text-[15px]";
const SMALL_BUTTON =
  "inline-flex h-9 shrink-0 items-center rounded-full border border-white/15 px-4 text-[14px] text-fg transition-colors hover:border-white/35 disabled:opacity-40";

export default function SubscribersPanel({ stories }: { stories: PetStories }) {
  const petId = stories.pet.id;
  const showToast = useUi((s) => s.showToast);
  const [subs, setSubs] = useState<Subscriber[] | null>(null);
  const [notified, setNotified] = useState<Record<string, string>>({});
  const [canSend, setCanSend] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const demo = !liveMode();

  const reload = useCallback(async () => {
    try {
      const [s, n] = await Promise.all([listSubscribers(petId), notifiedChapters(petId)]);
      setSubs(s);
      setNotified(n);
    } catch (e) {
      console.warn("[subscriptions] load failed", e);
      setSubs([]);
    }
  }, [petId]);

  useEffect(() => {
    void reload();
    void canSendEmail().then(setCanSend);
  }, [reload]);

  const counts = useMemo(() => {
    const c = { active: 0, pending: 0, stopped: 0 };
    for (const s of subs ?? []) {
      if (s.status === "active") c.active++;
      else if (s.status === "pending") c.pending++;
      else c.stopped++;
    }
    return c;
  }, [subs]);

  const published = useMemo(
    () => stories.volumes.flatMap((v) => v.chapters.filter((c) => c.status === "published")),
    [stories.volumes],
  );

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy("invite");
    const r = await invite(petId, email);
    setBusy(null);
    showToast(r.message, 4200);
    if (r.ok) {
      setEmail("");
      void reload();
    }
  }

  async function onNotify(chapterId: string, title: string) {
    const n = counts.active;
    if (!window.confirm(`Email "${title}" to ${n} ${n === 1 ? "subscriber" : "subscribers"}? Each chapter can be emailed once.`)) return;
    setBusy(chapterId);
    const r = await notifyChapter(petId, chapterId);
    setBusy(null);
    showToast(r.message, 4200);
    void reload();
  }

  const off = canSend === false;

  return (
    <details
      className="glass group mt-8 rounded-[24px] px-5 py-4 sm:px-6"
      data-subscribers
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void reload();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-1">
        <span>
          <span className="font-display block text-[22px] font-light text-fg">New chapters by email</span>
          <span className="mt-0.5 block text-[13px] text-muted" data-subscriber-counts>
            {subs === null
              ? "Loading…"
              : `${counts.active} subscribed · ${counts.pending} invited${counts.stopped ? ` · ${counts.stopped} stopped` : ""}`}
          </span>
        </span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>

      <div className="mt-4 flex flex-col gap-6 pb-2">
        {off ? (
          <p className="rounded-2xl border border-accent/25 bg-accent/[0.06] px-4 py-3 text-[14px] leading-relaxed text-fg/85" data-email-off>
            Sending is off until the site has a domain and Resend (Roadmap, Phase 5). Readers can already subscribe;
            invitations and chapter emails switch on then.
          </p>
        ) : demo ? (
          <p className="text-[13px] leading-relaxed text-muted">Demo: this all happens in your browser and nothing is sent.</p>
        ) : null}

        <form onSubmit={onInvite} className="flex flex-col gap-2" data-invite-form>
          <label htmlFor="invite-email" className="text-[14px] text-fg/85">
            Invite someone (they get one email and have to press Confirm)
          </label>
          <div className="flex gap-2">
            <input
              id="invite-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="their@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FIELD}
              disabled={off}
            />
            <button type="submit" className={SMALL_BUTTON + " h-11"} disabled={off || busy !== null || !email.trim()}>
              {busy === "invite" ? "Sending…" : "Invite"}
            </button>
          </div>
        </form>

        <div>
          <p className="text-[14px] text-fg/85">Email a chapter (once each)</p>
          {published.length ? (
            <ul className="mt-2 flex flex-col divide-y divide-white/10" data-notify-list>
              {published.map((c) => {
                const when = notified[c.id];
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5" data-notify-chapter={c.slug}>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] text-fg">{c.title}</span>
                      <a
                        href={`/api/subscriptions/preview?chapter=${encodeURIComponent(c.slug)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline"
                      >
                        See the email
                      </a>
                    </span>
                    {when ? (
                      <span className="shrink-0 text-[13px] text-muted" data-notified>
                        Emailed {new Date(when).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={SMALL_BUTTON}
                        disabled={off || busy !== null}
                        onClick={() => onNotify(c.id, c.title)}
                        data-notify
                      >
                        {busy === c.id ? "Sending…" : "Email it"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-muted">Publish a chapter first.</p>
          )}
        </div>

        {subs && subs.length ? (
          <div>
            <p className="text-[14px] text-fg/85">People</p>
            <ul className="mt-2 flex flex-col gap-1 text-[14px]" data-subscriber-list>
              {subs.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-fg/90">{s.email}</span>
                  <span className="shrink-0 text-[12px] text-muted">
                    {s.status === "active" ? "subscribed" : s.status === "pending" ? "invited" : s.status === "bounced" ? "bounced" : "stopped"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
