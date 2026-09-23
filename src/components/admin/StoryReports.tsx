"use client";
/**
 * The landing story on real devices: the latest anonymous story reports
 * (src/components/landing/SwipeStory/report.ts), readable by admins only
 * (RLS). One line per visit: when, which device and browser, how fast the
 * story started, how far it got, the most frames it held decoded, and the
 * first error if there was one. Live mode only; demo mode has no reports.
 */
import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase/browser";

interface Row {
  id: number;
  created_at: string;
  kind: "summary" | "stalled";
  report: {
    ua?: string;
    screen?: string;
    started?: boolean;
    startMs?: number;
    furthest?: number;
    peakDecoded?: number;
    broken?: number;
    waitMs?: number;
    skips?: number;
    crashedBefore?: boolean;
    errors?: string[];
    standalone?: boolean;
  };
}

/** "iPhone · Safari 26" from a user-agent string, roughly. */
export function deviceOf(ua = ""): string {
  const device = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "Other";
  const browser = /CriOS|Chrome\/\d/.test(ua) && !/Edg\//.test(ua)
    ? "Chrome"
    : /FxiOS|Firefox\//.test(ua)
      ? "Firefox"
      : /Edg\//.test(ua)
        ? "Edge"
        : /Safari\//.test(ua)
          ? `Safari ${/Version\/(\d+)/.exec(ua)?.[1] ?? ""}`.trim()
          : "";
  return browser ? `${device} · ${browser}` : device;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** `live`: the auth store's mode (the card renders only after its admin check, in the browser). */
export default function StoryReports({ live }: { live: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    browserSupabase()
      .from("story_reports")
      .select("id, created_at, kind, report")
      .order("created_at", { ascending: false })
      .limit(25)
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) setError(e.message);
        else setRows((data ?? []) as Row[]);
      });
    return () => {
      cancelled = true;
    };
  }, [live]);

  if (!live) return <p className="text-[14px] text-muted">Reports come from the live site; demo mode has none.</p>;
  if (error) return <p className="text-[14px] text-muted">Could not read the reports: {error}</p>;
  if (!rows) return <p className="text-[14px] text-muted">Reading…</p>;
  if (!rows.length) return <p className="text-[14px] text-muted">No visits reported yet.</p>;

  const started = rows.filter((r) => r.report.started).length;
  return (
    <div data-story-reports>
      <p className="text-[14px] text-fg/85">
        The last {rows.length} visits: the story started in {started}.
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-white/8 text-[13px]">
        {rows.map((r) => {
          const x = r.report;
          const ok = x.started && !(x.errors?.length ?? 0);
          return (
            <li key={r.id} className="flex flex-col gap-0.5 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-fg/90">
                  <span aria-hidden className={ok ? "text-emerald-300" : "text-[#ff9b8a]"}>
                    ●
                  </span>{" "}
                  {deviceOf(x.ua)}
                  {x.standalone ? " · home screen" : ""}
                </span>
                <span className="shrink-0 text-muted">{when(r.created_at)}</span>
              </div>
              <span className="text-muted">
                {r.kind === "stalled"
                  ? "never started (after 12 s)"
                  : x.started
                    ? `started in ${((x.startMs ?? 0) / 1000).toFixed(1)} s · ${
                        (x.furthest ?? -1) >= 0 ? `saw ${(x.furthest ?? 0) + 1} of 4 chapters` : "left during chapter 1"
                      }`
                    : "did not start"}
                {typeof x.peakDecoded === "number" ? ` · ${x.peakDecoded} frames held` : ""}
                {x.broken ? ` · ${x.broken} broken` : ""}
                {x.waitMs && x.waitMs >= 500 ? ` · waited ${(x.waitMs / 1000).toFixed(1)} s for frames` : ""}
                {x.skips ? ` · played past ${x.skips} missing` : ""}
                {x.crashedBefore ? " · the visit before crashed" : ""}
                {x.screen ? ` · ${x.screen}` : ""}
              </span>
              {x.errors?.length ? <span className="break-words text-[#ff9b8a]">{x.errors[0]}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
