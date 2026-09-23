"use client";
/**
 * The pages behind the links in story emails: /subscribe/confirm (say yes to
 * an invitation) and /unsubscribe (stop). Nothing changes on opening the page
 * (mail scanners open links); a press sends the token to the API.
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import Chrome from "@/components/chrome/Chrome";

type Action = "confirm" | "unsubscribe";

const COPY: Record<Action, { title: string; body: string; button: string; done: (pet: string) => string }> = {
  confirm: {
    title: "New chapters, by email",
    body: "Press the button and you'll get one email whenever a new chapter comes out. Nothing else, and every email has a way to stop.",
    button: "Yes, send them",
    done: (pet) => `Done. You'll get ${pet}'s next chapter by email.`,
  },
  unsubscribe: {
    title: "Stop the emails",
    body: "Press the button and no more chapters will come by email.",
    button: "Stop the emails",
    done: () => "Stopped. No more emails from us.",
  },
};

export default function EmailLinkAction({ action }: { action: Action }) {
  const params = useSearchParams();
  const token = params.get("t") ?? "";
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const copy = COPY[action];
  const valid = /^[0-9a-f]{64}$/.test(token);

  async function go() {
    setState("busy");
    try {
      const res = await fetch(`/api/subscriptions/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; petName?: string };
      if (!res.ok) {
        setState("error");
        setMessage(data.message ?? "That didn't work. Try again in a minute.");
        return;
      }
      setState("done");
      setMessage(copy.done(data.petName ?? "Kitty"));
    } catch {
      setState("error");
      setMessage("That didn't work. Check your connection and try again.");
    }
  }

  return (
    <>
      <Chrome hideCamera />
      <main
        className="mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col justify-center px-6 py-24"
        data-email-link={action}
        data-state={state}
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent">Kitty Stories</p>
        <h1 className="font-display mt-2 text-[40px] font-light leading-[1.05] text-fg">{copy.title}</h1>
        {state === "done" ? (
          <p className="mt-5 text-[16px] leading-relaxed text-fg/90" role="status">
            {message}
          </p>
        ) : valid ? (
          <>
            <p className="mt-5 text-[16px] leading-relaxed text-muted">{copy.body}</p>
            <button
              type="button"
              onClick={go}
              disabled={state === "busy"}
              className="mt-8 inline-flex h-12 w-fit items-center rounded-full bg-accent px-6 text-[16px] font-medium text-[#141414] transition-opacity hover:opacity-90 disabled:opacity-50"
              data-email-link-button
            >
              {state === "busy" ? "One moment…" : copy.button}
            </button>
            {state === "error" ? (
              <p className="mt-4 text-[14px] text-fg/85" role="alert">
                {message}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-5 text-[16px] leading-relaxed text-muted">
            This link is not complete. Open it again from the email (some mail apps cut long links).
          </p>
        )}
        <Link href="/stories" className="mt-10 text-[15px] text-muted underline-offset-4 hover:text-fg hover:underline">
          Read the stories
        </Link>
      </main>
    </>
  );
}
