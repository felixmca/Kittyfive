"use client";
/**
 * Chat with Kitty. A pill at the bottom expands into a panel that streams
 * text/plain replies from /api/chat into the last assistant bubble. Only the
 * last 12 turns (24 messages) are kept and sent. The input element stays
 * mounted across sends so iOS keeps the keyboard up.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { KITTY } from "@/config/kitty";
import { PRODUCTS } from "@/config/products";
import { useUi } from "@/lib/store";
import { useStoreState } from "@/components/store/storeState";
import { wrapIndex } from "@/components/store/spots";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Streaming or waiting for the first byte. */
  pending?: boolean;
}

const MAX_TURNS = 12;
const FALLBACK = "The wifi fell in the river. Ask me again in a moment.";
let nextId = 1;

function trimTurns<T>(list: T[]): T[] {
  const max = MAX_TURNS * 2;
  return list.length > max ? list.slice(list.length - max) : list;
}

export default function ChatDock() {
  const open = useUi((s) => s.chatOpen);
  const setOpen = useUi((s) => s.setChatOpen);
  const productIndex = useUi((s) => s.productIndex);
  const product = PRODUCTS[wrapIndex(productIndex, PRODUCTS.length)];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  function patchLast(fn: (m: ChatMessage) => ChatMessage) {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice();
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");

    const userMsg: ChatMessage = { id: nextId++, role: "user", content: text };
    const history = trimTurns([...messages.filter((m) => !m.pending && m.content), userMsg]);
    const payload = history.map(({ role, content }) => ({ role, content }));
    setMessages(
      trimTurns([...messages, userMsg, { id: nextId++, role: "assistant", content: "", pending: true }]),
    );
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload, productIndex }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const t = (await res.text().catch(() => "")).trim();
        patchLast((m) => ({ ...m, content: t || FALLBACK, pending: false }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const snapshot = acc;
        patchLast((m) => ({ ...m, content: snapshot }));
      }
      acc += decoder.decode();
      const final = acc.trim() || FALLBACK;
      patchLast((m) => ({ ...m, content: final, pending: false }));
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") return;
      patchLast((m) => ({ ...m, content: FALLBACK, pending: false }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="pointer-events-auto flex flex-col items-end">
      {/* Kept mounted (hidden when closed) so the input never remounts mid-conversation. */}
      <section
        role="dialog"
        aria-label="Chat with Kitty"
        hidden={!open}
        data-lenis-prevent
        className="glass mb-2 flex max-h-[55dvh] w-full flex-col overflow-hidden rounded-3xl text-fg"
      >
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <CatMark />
            <span className="font-display text-base">Kitty</span>
            <span className="truncate text-xs text-muted">· by the {product.name}</span>
          </div>
          <button
            type="button"
            aria-label="Close chat"
            onClick={() => setOpen(false)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-fg/80 hover:text-fg"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div
          ref={listRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3"
          aria-live="polite"
        >
          {messages.length === 0 && (
            <p className="px-1 text-sm text-muted">
              {KITTY.opening} Ask me about the {product.name}. Or anything, really.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug ${
                  m.role === "user" ? "bg-accent text-bg" : "bg-white/8 text-fg"
                }`}
              >
                {m.pending && !m.content ? <span className="text-muted">{KITTY.thinking}</span> : m.content}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={send} className="flex items-center gap-2 border-t border-white/10 p-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Say something to Kitty"
            enterKeyHint="send"
            autoComplete="off"
            maxLength={2000}
            aria-label="Message"
            className="min-h-[44px] min-w-0 flex-1 rounded-full bg-white/5 px-4 text-base text-fg outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/60"
          />
          <button
            type="submit"
            aria-label="Send"
            aria-busy={busy}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-bg transition-opacity aria-busy:opacity-70"
          >
            {busy ? (
              <span className="text-lg leading-none">{KITTY.thinking}</span>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            )}
          </button>
        </form>
      </section>

      <button
        type="button"
        hidden={open}
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          useStoreState.getState().setPanelOpen(false);
        }}
        className="glass flex min-h-[48px] items-center gap-2 rounded-full px-5 text-sm font-medium text-fg transition-transform active:scale-95"
      >
        <CatMark />
        Talk to Kitty
      </button>
    </div>
  );
}

/** Tiny black-and-white cat face used as the chat mark. */
function CatMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4 20 C3 12 5 8 8 7 L7 2 L11 6 L13 6 L17 2 L16 7 C19 8 21 12 20 20 Z"
        fill="#15151a"
        stroke="#f4f1ea"
        strokeWidth="1.2"
      />
      <ellipse cx="12" cy="17" rx="3.5" ry="2.2" fill="#f4f1ea" />
      <circle cx="9.5" cy="12" r="1.1" fill="#7dc56f" />
      <circle cx="14.5" cy="12" r="1.1" fill="#7dc56f" />
    </svg>
  );
}
