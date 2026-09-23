"use client";
/**
 * Who is signed in, and what they may do. One store for the whole app.
 *
 * Live mode (Supabase configured, no ?demo=1): email + password accounts with
 * confirm-email on, the Birthday Lobby pattern. The session lives in
 * localStorage; API routes that need to know the caller get the access token
 * as a bearer header (see accessToken()).
 *
 * Demo mode: a pretend account kept in localStorage. Any email and password
 * work, and the pretend user may edit Kitty's demo book, so every owner
 * screen can be exercised (and verified) without touching the real project.
 *
 * Admin status and edit rights come from the database (is_admin(),
 * can_edit_pet()); the UI only mirrors what RLS will allow anyway.
 */
import { create } from "zustand";
import { authLanding, scrubAuthParamsFromUrl } from "./authLanding";
import { browserSupabase, liveMode } from "@/lib/supabase/browser";
import { rememberAdmin } from "@/lib/supabase/sessionHint";

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

type Result = string | null; // an error sentence, or null for success

interface AuthState {
  ready: boolean;
  mode: "live" | "demo";
  user: AuthUser | null;
  isAdmin: boolean;
  /** Arrived from a password-recovery link: show "set a new password". */
  recovery: boolean;
  /** A sentence to show on the account page (e.g. an expired link). */
  notice: string | null;
  init: () => void;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error?: string; needsConfirm?: boolean }>;
  signIn: (email: string, password: string) => Promise<Result>;
  signOut: () => Promise<void>;
  /** Delete the signed-in account for good (and its story subscriptions); an error message, or null. */
  deleteAccount: () => Promise<string | null>;
  requestReset: (email: string) => Promise<Result>;
  setPassword: (password: string) => Promise<Result>;
  clearNotice: () => void;
  /** May the signed-in user edit this pet? Cached per pet for the session. */
  canEdit: (petId: string) => Promise<boolean>;
}

const DEMO_KEY = "kittyfive-demo-auth";
const editCache = new Map<string, Promise<boolean>>();
let started = false;

function demoUser(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { email?: string; displayName?: string };
    return { id: "demo-user", email: v.email ?? "demo@example.com", displayName: v.displayName ?? null };
  } catch {
    return null;
  }
}

function saveDemoUser(email: string, displayName?: string) {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify({ email, displayName }));
  } catch {
    /* private mode: demo sign-in lasts for this page only */
  }
}

/**
 * GoTrue's own sentences are fine except the mailer ones, which describe our
 * problem rather than the visitor's. Say what they mean.
 */
function humanise(message: string): string {
  if (/email rate limit/i.test(message)) {
    return "Our mailer is throttled right now, so that email will not arrive yet. Try again in a few minutes.";
  }
  if (/invalid login credentials/i.test(message)) return "That email and password do not match an account.";
  if (/email not confirmed/i.test(message)) {
    return "Your email is not confirmed yet. Open the link we sent you, then sign in.";
  }
  return message;
}

function redirectTo(path = "/account"): string | undefined {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}${path}`;
}

async function refreshAdmin(set: (p: Partial<AuthState>) => void, hasUser: boolean) {
  if (!hasUser) {
    set({ isAdmin: false });
    return;
  }
  try {
    const { data, error } = await browserSupabase().rpc("is_admin");
    const admin = !error && data === true;
    set({ isAdmin: admin });
    rememberAdmin(admin);
  } catch {
    set({ isAdmin: false });
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  ready: false,
  mode: "demo",
  user: null,
  isAdmin: false,
  recovery: false,
  notice: null,

  init: () => {
    if (started || typeof window === "undefined") return;
    started = true;

    if (!liveMode()) {
      const user = demoUser();
      set({ mode: "demo", ready: true, user, isAdmin: Boolean(user) });
      rememberAdmin(Boolean(user));
      return;
    }

    set({ mode: "live" });
    const sb = browserSupabase();
    if (authLanding.error) {
      set({ notice: `That link did not work: ${authLanding.error}. Ask for a new one below.` });
    }
    if (authLanding.type === "recovery") set({ recovery: true });

    sb.auth.onAuthStateChange((event, session) => {
      const u = session?.user;
      const user: AuthUser | null = u
        ? { id: u.id, email: u.email ?? null, displayName: (u.user_metadata?.display_name as string) ?? null }
        : null;
      const prev = get().user;
      set({ user });
      if (event === "PASSWORD_RECOVERY") set({ recovery: true });
      if (prev?.id !== user?.id) {
        editCache.clear();
        void refreshAdmin(set, Boolean(user));
      }
    });

    void sb.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user;
      set({
        ready: true,
        user: u ? { id: u.id, email: u.email ?? null, displayName: (u.user_metadata?.display_name as string) ?? null } : null,
      });
      await refreshAdmin(set, Boolean(u));
      if (authLanding.type || authLanding.error || authLanding.tokenHash) scrubAuthParamsFromUrl();
    });
  },

  signUp: async (email, password, displayName) => {
    if (get().mode === "demo") {
      saveDemoUser(email, displayName);
      set({ user: { id: "demo-user", email, displayName }, isAdmin: true });
      rememberAdmin(true);
      return {};
    }
    const { data, error } = await browserSupabase().auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName }, emailRedirectTo: redirectTo("/account") },
    });
    if (error) return { error: humanise(error.message) };
    if (!data.session) return { needsConfirm: true };
    return {};
  },

  signIn: async (email, password) => {
    if (get().mode === "demo") {
      saveDemoUser(email);
      set({ user: { id: "demo-user", email, displayName: null }, isAdmin: true });
      rememberAdmin(true);
      return null;
    }
    const { error } = await browserSupabase().auth.signInWithPassword({ email, password });
    return error ? humanise(error.message) : null;
  },

  signOut: async () => {
    editCache.clear();
    if (get().mode === "demo") {
      try {
        window.localStorage.removeItem(DEMO_KEY);
      } catch {
        /* ignore */
      }
      set({ user: null, isAdmin: false, recovery: false });
      rememberAdmin(false);
      return;
    }
    await browserSupabase().auth.signOut();
    set({ user: null, isAdmin: false, recovery: false });
    rememberAdmin(false);
  },

  deleteAccount: async () => {
    if (get().mode === "demo") {
      try {
        window.localStorage.removeItem("kittyfive-demo-subscriptions-v1");
      } catch {
        /* ignore */
      }
      await get().signOut();
      return null;
    }
    const { error } = await browserSupabase().rpc("delete_my_account");
    if (error) return "That didn't work. Try again, or sign out and back in first.";
    editCache.clear();
    // The account is gone; clear this browser's session too (the server may
    // already refuse it, which is fine).
    try {
      await browserSupabase().auth.signOut({ scope: "local" });
    } catch {
      /* ignore */
    }
    set({ user: null, isAdmin: false, recovery: false });
    rememberAdmin(false);
    return null;
  },

  requestReset: async (email) => {
    if (get().mode === "demo") return null;
    const { error } = await browserSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo("/account"),
    });
    // GoTrue answers the same for unknown addresses, so an error here is
    // always about us (rate limit, mailer), never about the address.
    return error ? humanise(error.message) : null;
  },

  setPassword: async (password) => {
    if (get().mode === "demo") {
      set({ recovery: false });
      return null;
    }
    const { error } = await browserSupabase().auth.updateUser({ password });
    if (error) return humanise(error.message);
    set({ recovery: false });
    return null;
  },

  clearNotice: () => set({ notice: null }),

  canEdit: (petId) => {
    const { mode, user } = get();
    if (!user) return Promise.resolve(false);
    if (mode === "demo") return Promise.resolve(true);
    const cached = editCache.get(petId);
    if (cached) return cached;
    const p = (async () => {
      try {
        const { data, error } = await browserSupabase().rpc("can_edit_pet", { p_pet: petId });
        return !error && data === true;
      } catch {
        return false;
      }
    })();
    editCache.set(petId, p);
    return p;
  },
}));

/** The signed-in user's access token, for API routes that must know the caller. */
export async function accessToken(): Promise<string | null> {
  if (!liveMode()) return null;
  try {
    const { data } = await browserSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
