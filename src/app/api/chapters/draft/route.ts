/**
 * POST /api/chapters/draft: photos + "what happened" → a chapter draft.
 *
 * Body: { petId, photos: string[] (public story-media URLs), text, volumeId?, demo? }
 * Auth: Authorization: Bearer <access token> of someone who can edit the pet
 * (checked with can_edit_pet() under their own RLS). Demo mode never calls
 * Claude: it returns a draft built from the owner's own sentences.
 *
 * Claude Opus 5 reads the photos (as URLs in the pet's folder of the public
 * bucket, nothing else) and writes the chapter in the owner's voice, with a
 * Kling 3.0 prompt per scene, as structured JSON. Server-side fallbacks are
 * on, so a request a safety classifier declines is retried on the model
 * Anthropic recommends for that case instead of failing.
 */
import Anthropic from "@anthropic-ai/sdk";
import { cannedDraft, DRAFT_SCHEMA, sanitiseDraft } from "@/lib/stories/draft";
import { clientKey, rateLimit } from "@/lib/rateLimit";
import { SUPABASE_URL, supabaseConfigured } from "@/lib/supabase/config";
import { bearerToken, serverSupabaseAs } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PHOTOS = 8;
const MAX_TEXT = 4000;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const SYSTEM = `You turn a pet owner's photos and a few sentences about what happened into one chapter of their pet's life story.

The chapter is a short scroll on a phone: 2 to 6 full-screen scenes in story order. Each scene is one of the owner's photos, which the owner will later animate into a 5-second clip (Kling 3.0, image-to-video, 9:16), with one to three short lines of text fading in over its lower third. The reader's scroll plays the clip forwards and backwards.

Truth
- Use only what the owner wrote and what is visible in the photos. Never invent names, places, events, dates or feelings. If something is visible but not mentioned, you may state it plainly.
- Never describe or name people who appear in the photos.

Voice
- First person, in the owner's voice. Match the tone of their words and of the volume's story if one is given.
- Short sentences. Dry and warm. No exclamation marks, no emoji, no pet clichés, no rhetorical questions.

Fields
- title: 2 to 5 words. subtitle: one line. description: one or two sentences for the chapter's tile.
- scenes: use each photo at most once where you can; order them so the story reads well, not necessarily as uploaded. beats: 1 to 3 lines per scene, each at most 120 characters; together they tell what happened. kicker: a short time or place if the owner gave one, else an empty string.
- focusX, focusY: where the pet's face (or the key subject) is in that photo, as fractions from the left and from the top. They centre the slow zoom and the 9:16 crop of the start frame.
- videoPrompt: one paragraph for Kling 3.0 where this photo is the first frame. Exactly one slow, smooth camera move and one small, plausible action by the pet that starts from its exact pose in the photo, then an end state (it settles, it holds a look). Keep the setting and light as in the photo and the pet's markings and colours exactly. End with: "Photoreal, smooth steady camera, one continuous shot." No cuts, no shake, no sudden moves (the clip is scrubbed by scrolling). Never ask for text, extra animals or people's faces. At most 600 characters.`;

interface Body {
  petId?: unknown;
  photos?: unknown;
  text?: unknown;
  volumeId?: unknown;
  demo?: unknown;
}

let client: Anthropic | null = null;

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Send JSON." }, 400);
  }
  const petId = typeof body.petId === "string" ? body.petId : "";
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  const photos = Array.isArray(body.photos)
    ? body.photos.filter((p): p is string => typeof p === "string").slice(0, MAX_PHOTOS)
    : [];
  if (!petId || !text) return json({ error: "Add a few sentences about what happened." }, 400);

  // Demo mode, or a deployment with nothing configured: no account, no Claude.
  if (body.demo === true || !supabaseConfigured) {
    return json({ draft: cannedDraft(text, photos.length, "Kitty"), source: "demo" });
  }

  const token = bearerToken(req);
  const caller = token ? await serverSupabaseAs(token) : null;
  if (!caller) return json({ error: "Sign in first." }, 401);

  const limited = rateLimit(`draft:${caller.userId}:${clientKey(req)}`, { limit: 12, windowMs: 10 * 60_000 });
  if (!limited.ok) return json({ error: "That is a lot of drafts. Try again in a few minutes." }, 429);

  const { data: allowed, error: rpcError } = await caller.sb.rpc("can_edit_pet", { p_pet: petId });
  if (rpcError || allowed !== true) return json({ error: "You cannot edit this pet's stories." }, 403);

  // Photos must be in this pet's folder of our own bucket.
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/story-media/pets/${petId}/`;
  if (photos.some((p) => !p.startsWith(prefix))) return json({ error: "Those photos are not in this pet's album." }, 400);

  const [{ data: pet }, volume] = await Promise.all([
    caller.sb.from("pets").select("name, species").eq("id", petId).maybeSingle(),
    typeof body.volumeId === "string"
      ? caller.sb.from("volumes").select("title, subtitle, body").eq("id", body.volumeId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const petName = (pet?.name as string | undefined) ?? "the pet";

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ draft: cannedDraft(text, photos.length, petName), source: "no-key" });
  }

  const v = volume.data as { title?: string; subtitle?: string | null; body?: string[] } | null;
  const context = [
    `Pet: ${petName}${pet?.species ? ` (${pet.species})` : ""}.`,
    v?.title ? `This chapter goes in the volume "${v.title}".${v.subtitle ? ` ${v.subtitle}` : ""}` : "",
    v?.body?.length ? `The volume's story so far, for tone:\n${v.body.join("\n\n")}` : "",
    `What happened, in the owner's words:\n${text}`,
    photos.length
      ? `There are ${photos.length} photos, numbered 0 to ${photos.length - 1} in the order shown.`
      : "There are no photos yet; write one scene per beat and use photo 0.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  photos.forEach((url, i) => {
    content.push({ type: "text", text: `Photo ${i}:` });
    content.push({ type: "image", source: { type: "url", url } });
  });
  content.push({ type: "text", text: context });

  client ??= new Anthropic();
  try {
    const message = await client.beta.messages
      .stream({
        model: "claude-opus-5",
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
        system: SYSTEM,
        messages: [{ role: "user", content }],
      })
      .finalMessage();

    if (message.stop_reason === "refusal") {
      return json({ error: "Claude would not draft this one. Try describing it differently." }, 422);
    }
    if (message.stop_reason === "max_tokens") {
      return json({ error: "The draft ran long and was cut off. Try again with fewer photos." }, 502);
    }
    const textBlock = message.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
    if (!textBlock) return json({ error: "Claude returned nothing to read." }, 502);
    const draft = sanitiseDraft(JSON.parse(textBlock.text), photos.length);
    if (!draft.scenes.length) return json({ error: "The draft had no scenes. Try again." }, 502);
    return json({ draft, source: "claude" });
  } catch (err) {
    let message = "Could not reach Claude. Try again in a moment.";
    let status = 502;
    if (err instanceof Anthropic.AuthenticationError) message = "The Claude key on the server is not valid.";
    else if (err instanceof Anthropic.RateLimitError) {
      message = "Claude is busy. Try again in a minute.";
      status = 429;
    } else if (err instanceof Anthropic.BadRequestError) message = "Claude could not read one of the photos. Try other photos.";
    else if (err instanceof SyntaxError) message = "The draft came back malformed. Try again.";
    console.warn("[api/chapters/draft]", err instanceof Error ? err.name : typeof err, err instanceof Anthropic.APIError ? err.status : "");
    return json({ error: message }, status);
  }
}
