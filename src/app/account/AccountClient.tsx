"use client";
/**
 * /account: sign in, create an account, reset a forgotten password, set a new
 * one after following a reset link, and sign out. Supabase email + password
 * with confirm-email on (the Birthday Lobby pattern).
 *
 * Reset and confirmation links come back to this page. authLanding captured
 * the link's parameters before the Supabase client consumed them, which is
 * how a visitor arriving from a reset link gets the "new password" form
 * instead of a signed-in page with nothing changed.
 *
 * ?next=/some/page (a path on this site) sends a visitor back there once they
 * are signed in: "Sign in to get them" on /stories comes back to /stories.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Chrome from "@/components/chrome/Chrome";
import { SITE } from "@/config/site";
import { useAuth } from "@/lib/auth/store";

type Mode = "signin" | "signup" | "forgot";

const FIELD =
  "w-full rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-3 text-[16px] text-fg placeholder:text-white/30 outline-none transition-colors focus:border-accent/70 focus:bg-white/[0.07]";
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.16em] text-muted";
const PRIMARY =
  "flex h-12 w-full items-center justify-center rounded-full bg-accent text-[16px] font-medium text-[#141414] transition-opacity hover:opacity-90 disabled:opacity-60";

/** A path on this site to go back to, from ?next= (never another site). */
function nextPath(): string | null {
  if (typeof window === "undefined") return null;
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return /^\/(?!\/)[^\s\\]*$/.test(next) ? next : null;
}

export default function AccountClient() {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => {
    auth.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed in (now, or already) and sent here from somewhere: go back there.
  useEffect(() => {
    if (!auth.ready || !auth.user || auth.recovery) return;
    const next = nextPath();
    if (next) router.replace(next);
  }, [auth.ready, auth.user, auth.recovery, router]);

  let body: ReactNode;
  if (!auth.ready) body = <p className="text-muted">One moment…</p>;
  else if (auth.recovery && auth.user) body = <SetPassword />;
  else if (auth.user) body = <SignedIn />;
  else body = <AuthForms />;

  return (
    <>
      <Chrome />
      <main
        className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col px-5 pb-24"
        style={{ paddingTop: "calc(max(12px, env(safe-area-inset-top)) + 84px)" }}
        data-account
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent">{SITE.name}</p>
        <h1 className="font-display mt-2 text-[40px] font-light leading-[1.05] text-fg">Your account</h1>
        {auth.mode === "demo" && auth.ready ? (
          <p className="mt-3 rounded-xl border border-accent/25 bg-accent/[0.06] px-3.5 py-2.5 text-[13px] leading-relaxed text-fg/80" data-demo-note>
            Demo mode: accounts here are pretend and live in this browser. Any email and password work.
          </p>
        ) : null}
        {auth.notice ? (
          <p role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-[14px] text-red-200">
            {auth.notice}
          </p>
        ) : null}
        <div className="mt-8">{body}</div>
      </main>
    </>
  );
}

function AuthForms() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>(auth.notice ? "forgot" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<null | "confirm" | "reset">(null);

  function go(next: Mode) {
    setMode(next);
    setError(null);
    setSent(null);
    auth.clearNotice();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const address = email.trim();
    if (!address) {
      setError("Type your email address.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("Passwords need at least 8 characters.");
      return;
    }
    if (mode === "signin" && !password) {
      setError("Type your password.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const r = await auth.signUp(address, password, name.trim());
        if (r.error) setError(r.error);
        else if (r.needsConfirm) setSent("confirm");
      } else if (mode === "signin") {
        const err = await auth.signIn(address, password);
        if (err) setError(err);
      } else {
        const err = await auth.requestReset(address);
        if (err) setError(err);
        else setSent("reset");
      }
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4" data-auth-sent={sent}>
        <h2 className="font-display text-[26px] font-light text-fg">Check your email</h2>
        <p className="text-[15px] leading-relaxed text-muted">
          {sent === "confirm"
            ? `We sent a link to ${email.trim()}. Open it to confirm the address, and you will be signed in.`
            : `If ${email.trim()} has an account, a reset link is on its way. It works once and expires in an hour.`}
        </p>
        <p className="text-[13px] leading-relaxed text-muted">Nothing after a few minutes? Check spam, then try again.</p>
        <button type="button" onClick={() => go("signin")} className="self-start text-[14px] text-accent underline-offset-4 hover:underline">
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div>
      {mode !== "forgot" ? (
        <div className="mb-6 flex rounded-full border border-white/12 p-1" role="tablist" aria-label="Account">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => go(m)}
              className={`flex-1 rounded-full px-4 py-2.5 text-[15px] transition-colors ${
                mode === m ? "bg-white/12 text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-6">
          <h2 className="font-display text-[26px] font-light text-fg">Forgotten your password?</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Type the address you signed up with and we will send a link to set a new one.
          </p>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4" data-auth-form={mode}>
        {mode === "signup" ? (
          <div>
            <label className={LABEL} htmlFor="acct-name">Your name</label>
            <input id="acct-name" className={FIELD} value={name} maxLength={60} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </div>
        ) : null}
        <div>
          <label className={LABEL} htmlFor="acct-email">Email</label>
          <input
            id="acct-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            className={FIELD}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {mode !== "forgot" ? (
          <div>
            <label className={LABEL} htmlFor="acct-password">Password</label>
            <input
              id="acct-password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              className={FIELD}
              value={password}
              placeholder="At least 8 characters"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-[14px] text-red-200" data-auth-error>
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={PRIMARY}>
          {busy ? "One moment…" : mode === "signup" ? "Create account" : mode === "signin" ? "Sign in" : "Send the link"}
        </button>
        {mode === "signin" ? (
          <button type="button" onClick={() => go("forgot")} className="self-center text-[14px] text-muted hover:text-fg">
            Forgotten your password?
          </button>
        ) : null}
        {mode === "forgot" ? (
          <button type="button" onClick={() => go("signin")} className="self-center text-[14px] text-muted hover:text-fg">
            Back to sign in
          </button>
        ) : null}
      </form>
    </div>
  );
}

function SetPassword() {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Passwords need at least 8 characters.");
    if (password !== again) return setError("Those two do not match.");
    setBusy(true);
    const err = await auth.setPassword(password);
    setBusy(false);
    if (err) setError(err);
    else setDone(true);
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-[26px] font-light text-fg">New password saved</h2>
        <p className="text-[15px] text-muted">You are signed in.</p>
        <Link href="/stories" className="text-[15px] text-accent underline-offset-4 hover:underline">Go to the stories</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-set-password>
      <h2 className="font-display text-[26px] font-light text-fg">Choose a new password</h2>
      <p className="text-[15px] text-muted">Your link worked. Pick a password and you are back in.</p>
      <div>
        <label className={LABEL} htmlFor="new-pw">New password</label>
        <input id="new-pw" type="password" autoComplete="new-password" className={FIELD} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div>
        <label className={LABEL} htmlFor="new-pw2">Again, to be sure</label>
        <input id="new-pw2" type="password" autoComplete="new-password" className={FIELD} value={again} onChange={(e) => setAgain(e.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-[14px] text-red-200">{error}</p>
      ) : null}
      <button type="submit" disabled={busy} className={PRIMARY}>{busy ? "Saving…" : "Save password"}</button>
    </form>
  );
}

function SignedIn() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const user = auth.user!;
  return (
    <div className="flex flex-col gap-6" data-signed-in>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">Signed in as</p>
        <p className="mt-1.5 break-all text-[17px] text-fg">{user.email}</p>
        {user.displayName ? <p className="mt-1 text-[14px] text-muted">{user.displayName}</p> : null}
        {auth.isAdmin ? (
          <p className="mt-3 inline-flex rounded-full bg-accent/15 px-3 py-1 text-[12px] font-medium text-accent" data-admin-badge>
            Admin
          </p>
        ) : null}
      </div>
      <nav className="flex flex-col gap-2" aria-label="Your things">
        <Link href="/stories" className={ROW}>
          <span>{auth.isAdmin ? "Edit Kitty Stories" : "Kitty Stories"}</span>
          <span aria-hidden>→</span>
        </Link>
        {auth.isAdmin ? (
          <Link href="/admin" className={ROW}>
            <span>Admin dashboard</span>
            <span aria-hidden>→</span>
          </Link>
        ) : null}
      </nav>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await auth.signOut();
          setBusy(false);
        }}
        className="self-start rounded-full border border-white/15 px-5 py-2.5 text-[15px] text-fg hover:border-white/35"
        data-sign-out
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      <DeleteAccount />
    </div>
  );
}

/** Delete the account for good, after typing DELETE (one tap is too easy on a phone). */
function DeleteAccount() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-[14px] text-muted underline-offset-4 hover:text-fg hover:underline"
        data-delete-account
      >
        Delete my account
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-red-400/30 bg-red-500/[0.06] p-5" data-delete-confirm>
      <p className="text-[15px] leading-relaxed text-fg">
        This deletes your account and any story emails you get, for good. Stories you made stay on the site.
      </p>
      <label htmlFor="delete-typed" className="mt-4 block text-[13px] text-muted">
        Type DELETE to confirm
      </label>
      <input
        id="delete-typed"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        className="mt-1.5 w-full rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-3 text-[16px] text-fg outline-none focus:border-red-300/70"
      />
      {error ? (
        <p role="alert" className="mt-3 text-[14px] text-red-200">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || typed.trim() !== "DELETE"}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const err = await auth.deleteAccount();
            setBusy(false);
            if (err) setError(err);
          }}
          className="rounded-full bg-red-400/90 px-5 py-2.5 text-[15px] font-medium text-[#141414] disabled:opacity-40"
          data-delete-go
        >
          {busy ? "Deleting…" : "Delete for good"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
          className="rounded-full border border-white/15 px-5 py-2.5 text-[15px] text-fg hover:border-white/35"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}

const ROW =
  "flex min-h-14 items-center justify-between rounded-2xl border border-white/10 px-5 text-[16px] text-fg transition-colors hover:bg-white/[0.05]";
