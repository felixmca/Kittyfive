/**
 * The two story emails (Phase 5):
 *
 *   invitation   an owner asked for you to get their pet's new chapters;
 *                nothing more arrives unless you press Confirm (double opt-in)
 *   new chapter  the chapter's tile picture, title and a link to read it
 *
 * Every link that acts carries the subscription's token, and the pages they
 * open ask for a press before anything changes (mail scanners open links).
 * New-chapter emails also carry List-Unsubscribe and List-Unsubscribe-Post,
 * so mail apps can offer a one-click unsubscribe (RFC 8058).
 */
import { SITE } from "@/config/site";
import { esc, wrapHtml, type Mail } from "@/lib/mail";
import { mediaUrl } from "@/lib/supabase/config";

const BUTTON =
  "display:inline-block;background:#ffd166;color:#141414;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px";
const P = "margin:0 0 16px;font-size:15px;line-height:1.55;color:#e8e4dc";
const SMALL = "margin:18px 0 0;color:#9a958c;font-size:12px;line-height:1.5";

/** An absolute URL on this site (tile pictures are often stored as paths). */
export function siteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE.url.replace(/\/$/, "")}/${pathOrUrl.replace(/^\//, "")}`;
}

export const confirmUrl = (token: string) => siteUrl(`/subscribe/confirm?t=${encodeURIComponent(token)}`);
export const unsubscribeUrl = (token: string) => siteUrl(`/unsubscribe?t=${encodeURIComponent(token)}`);
/** Where mail apps POST a one-click unsubscribe. */
export const oneClickUrl = (token: string) => siteUrl(`/api/subscriptions/unsubscribe?t=${encodeURIComponent(token)}`);

export function inviteEmail(o: { to: string; petName: string; token: string }): Mail {
  const pet = o.petName;
  const confirm = confirmUrl(o.token);
  const subject = `${pet}'s new chapters, by email?`;
  const text = [
    `Hello,`,
    ``,
    `You've been invited to get ${pet}'s new chapters by email: a short story, now and then, made from real photos.`,
    ``,
    `To say yes, open this link and press Confirm:`,
    confirm,
    ``,
    `If you'd rather not, do nothing. You won't hear from us again about it.`,
    ``,
    `${SITE.name} · ${SITE.url}`,
  ].join("\n");
  const html = wrapHtml(
    `${pet}'s new chapters, by email?`,
    `<p style="${P}">You've been invited to get ${esc(pet)}'s new chapters by email: a short story, now and then, made from real photos.</p>
<p style="margin:24px 0"><a href="${esc(confirm)}" style="${BUTTON}">Yes, send them</a></p>
<p style="${P}">If you'd rather not, do nothing. You won't hear from us again about it.</p>`,
    `<p style="${SMALL}">You got this because someone who looks after ${esc(pet)} typed your address. <a href="${esc(siteUrl(`/stories`))}" style="color:#9a958c">Read the stories</a> without signing up.</p>`,
  );
  return { to: o.to, subject, text, html };
}

export interface ChapterForEmail {
  petName: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  slug: string;
  image: string | null;
}

export function chapterEmail(o: { to: string; token: string; chapter: ChapterForEmail }): Mail {
  const c = o.chapter;
  const read = siteUrl(`/stories/${c.slug}`);
  const stop = unsubscribeUrl(o.token);
  const subject = `${c.petName}: ${c.title}`;
  const lines = [c.subtitle, c.description].filter((x): x is string => Boolean(x && x.trim()));
  const text = [
    `A new chapter of ${c.petName}'s story: ${c.title}`,
    ...lines.map((l) => `\n${l}`),
    ``,
    `Read it: ${read}`,
    ``,
    `---`,
    `Stop these emails: ${stop}`,
  ].join("\n");
  // Stored as a site path, a full URL or a storage-bucket path; only a real
  // web address can go in an email (never a demo data: URL).
  const src = mediaUrl(c.image);
  const image = src && /^(https?:|\/)/.test(src) ? siteUrl(src) : null;
  const picture = image
    ? `<a href="${esc(read)}" style="display:block;margin:0 0 20px"><img src="${esc(image)}" alt="" width="520" style="display:block;width:100%;max-width:520px;height:auto;border-radius:18px;border:0"></a>`
    : "";
  const html = wrapHtml(
    c.title,
    `${picture}${lines.map((l) => `<p style="${P}">${esc(l)}</p>`).join("")}
<p style="margin:24px 0"><a href="${esc(read)}" style="${BUTTON}">Read the chapter</a></p>`,
    `<p style="${SMALL}">You get ${esc(c.petName)}'s new chapters because you asked to. <a href="${esc(stop)}" style="color:#9a958c">Stop these emails</a>.</p>`,
  );
  return {
    to: o.to,
    subject,
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${oneClickUrl(o.token)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
