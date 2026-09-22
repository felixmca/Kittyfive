/**
 * POST /api/chat: stream Kitty's reply as text/plain.
 *
 * Body: { messages: [{ role: "user" | "assistant", content: string }], productIndex: number }
 *
 * - System prompt from src/config/kitty.ts is the stable, prompt-cached block;
 *   the current product context is a second system block after it.
 * - No ANTHROPIC_API_KEY: a canned, in-character line is streamed so the UI
 *   works in demo mode.
 * - Anthropic API errors become a 502 with an in-character one-liner.
 * - Message contents are never logged.
 */
import Anthropic from "@anthropic-ai/sdk";
import { KITTY } from "@/config/kitty";
import { PRODUCTS } from "@/config/products";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

const MAX_MESSAGES = 24;
const MAX_CONTENT = 2000;
const TEXT_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
} as const;

/** Demo-mode replies when no key is configured. */
const CANNED: readonly string[] = [
  "The humans have not plugged my brain in yet. Press Buy; that part works.",
  "I would answer, but nobody has paid for my thoughts this month. The cap is embroidered, by the way.",
  "Demo mode. I am a cat in a room with no wifi. The hoodie is still soft.",
  "My brain arrives when the humans add a key. Until then, look at the long-sleeve. Real ink.",
  "Nothing plugged in. I am mostly here for the snacks anyway.",
  "You are talking to a placeholder cat. Same face, fewer opinions. Buy still works.",
];

const OFFLINE = "The wifi fell in the river. Ask me again in a moment.";
const BUSY = "Too many humans talking at once. Give me a minute.";
const BAD_KEY = "The humans gave me the wrong key. Press Buy; that part still works.";
const BAD_REQUEST = "Say that again, slower. And shorter.";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const METHOD_LABEL: Record<(typeof PRODUCTS)[number]["method"], string> = {
  embroidery: "embroidered",
  "screen-print": "screen-printed",
};

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function parseBody(raw: unknown): { messages: Turn[]; productIndex: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const { messages, productIndex } = raw as { messages?: unknown; productIndex?: unknown };
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null;
  if (typeof productIndex !== "number" || !Number.isInteger(productIndex)) return null;

  const turns: Turn[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" || content.length > MAX_CONTENT) return null;
    const text = content.trim();
    if (!text) continue;
    turns.push({ role, content: text });
  }

  // The conversation must start and end with the visitor.
  while (turns.length > 0 && turns[0].role !== "user") turns.shift();
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") return null;

  const n = PRODUCTS.length;
  return { messages: turns, productIndex: ((productIndex % n) + n) % n };
}

/** Short second system block: what she is standing next to, and the full range. */
function productContext(index: number): string {
  const current = PRODUCTS[index];
  const list = PRODUCTS.map(
    (p, i) =>
      `${i === index ? "> " : "- "}${p.name}: ${METHOD_LABEL[p.method]}, ${gbp.format(p.pricePence / 100)}. ${p.description}`,
  ).join("\n");
  return [
    `Kitty is currently standing beside the ${current.name} (${METHOD_LABEL[current.method]}, ${gbp.format(current.pricePence / 100)}).`,
    `Her usual pitch for it: "${current.pitch}"`,
    "All three products in the store (> marks the current one):",
    list,
    "The visitor buys with the Buy button on the product panel; Kitty never takes payment herself.",
  ].join("\n");
}

/** Stream a fixed line word by word so demo mode feels like the real thing. */
function streamText(text: string, status = 200): Response {
  const encoder = new TextEncoder();
  const parts = text.split(/(?<=\s)/);
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part));
        await new Promise((r) => setTimeout(r, 24));
      }
      controller.close();
    },
  });
  return new Response(body, { status, headers: TEXT_HEADERS });
}

function upstreamFailure(err: unknown): Response {
  // Most specific first. Only the error class and status are logged.
  let line = OFFLINE;
  if (err instanceof Anthropic.AuthenticationError) line = BAD_KEY;
  else if (err instanceof Anthropic.RateLimitError) line = BUSY;
  const status = err instanceof Anthropic.APIError ? err.status : undefined;
  console.warn("[api/chat] upstream failure", err instanceof Error ? err.name : typeof err, status ?? "");
  return new Response(line, { status: 502, headers: TEXT_HEADERS });
}

let client: Anthropic | null = null;

const NAP = "Too many questions. I need a nap. Try again in a few minutes.";

export async function POST(req: Request): Promise<Response> {
  // Unauthenticated Opus calls: cap per IP before touching the body.
  const limited = rateLimit(`chat:${clientKey(req)}`, { limit: 30, windowMs: 10 * 60_000 });
  if (!limited.ok) {
    return new Response(NAP, {
      status: 429,
      headers: { ...TEXT_HEADERS, "Retry-After": String(limited.retryAfterSec) },
    });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response(BAD_REQUEST, { status: 400, headers: TEXT_HEADERS });
  }
  const parsed = parseBody(raw);
  if (!parsed) return new Response(BAD_REQUEST, { status: 400, headers: TEXT_HEADERS });
  const { messages, productIndex } = parsed;

  if (!process.env.ANTHROPIC_API_KEY) return streamText(pick(CANNED));

  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  const encoder = new TextEncoder();

  try {
    const stream = client.messages.stream({
      model: "claude-opus-5",
      max_tokens: 1024,
      output_config: { effort: "low" },
      system: [
        { type: "text", text: KITTY.system, cache_control: { type: "ephemeral" } },
        { type: "text", text: productContext(productIndex) },
      ],
      messages: messages as Anthropic.MessageParam[],
    });

    // Text is buffered until the Response body is being read, so nothing
    // emitted between connecting and the first read is lost.
    const buffered: string[] = [];
    let sink: ReadableStreamDefaultController<Uint8Array> | null = null;
    let sinkClosed = false;
    let ended = false;
    let gotText = false;

    const emit = (t: string) => {
      if (sink) sink.enqueue(encoder.encode(t));
      else buffered.push(t);
    };
    const finish = () => {
      ended = true;
      if (sink && !sinkClosed) {
        sinkClosed = true;
        try {
          sink.close();
        } catch {
          /* already cancelled by the client */
        }
      }
    };

    stream.on("text", (t) => {
      gotText = true;
      emit(t);
    });
    stream.on("end", finish);
    stream.on("abort", finish);
    stream.on("error", (err) => {
      console.warn("[api/chat] stream error", err.name);
      if (!gotText) emit(OFFLINE);
      finish();
    });

    // Wait for the API to accept the request so auth and rate-limit failures
    // come back as a tidy 502 rather than a body that dies half-way.
    await stream.emitted("connect");

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        sink = controller;
        for (const t of buffered) controller.enqueue(encoder.encode(t));
        buffered.length = 0;
        if (ended) finish();
      },
      cancel() {
        try {
          stream.abort();
        } catch {
          /* already finished */
        }
      },
    });
    return new Response(body, { headers: TEXT_HEADERS });
  } catch (err) {
    return upstreamFailure(err);
  }
}
