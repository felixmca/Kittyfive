/**
 * Sending email, for every part of the site (order emails, story
 * subscriptions). Resend when RESEND_API_KEY + EMAIL_FROM are set; otherwise
 * nothing is sent and a line is logged, so every flow still runs in dev and
 * demo mode. Never throws: a failed email must not fail what triggered it.
 *
 * Server-only.
 */
import { Resend } from "resend";
import { SITE } from "@/config/site";
import { getEnv, hasEmail } from "@/lib/commerce/env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

export interface Delivery {
  sent: boolean;
  id?: string;
}

/** Resend's batch endpoint takes at most 100 emails a call. */
const BATCH = 100;

let resend: Resend | null = null;

/** Can this deployment send email at all? */
export function mailConfigured(): boolean {
  return hasEmail(getEnv());
}

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The site's email frame: dark, the wordmark, a title, the body, and a footer line. */
export function wrapHtml(title: string, bodyHtml: string, footerHtml = ""): string {
  return `<!doctype html><html lang="en-GB"><body style="margin:0;background:#0b0b0c;color:#f4f1ea;font-family:Inter,ui-sans-serif,system-ui,sans-serif;padding:32px 16px">
<div style="max-width:520px;margin:0 auto">
<p style="margin:0 0 8px;color:#ffd166;font-size:12px;letter-spacing:.14em;text-transform:uppercase">${esc(SITE.name)}</p>
<h1 style="margin:0 0 20px;font-family:Fraunces,Georgia,serif;font-weight:300;font-size:28px;line-height:1.15">${esc(title)}</h1>
${bodyHtml}
<p style="margin:28px 0 0;color:#9a958c;font-size:13px">${esc(SITE.tagline)} · <a href="${esc(SITE.url)}" style="color:#9a958c">${esc(SITE.url.replace(/^https?:\/\//, ""))}</a></p>
${footerHtml}
</div></body></html>`;
}

function client(): Resend | null {
  const env = getEnv();
  if (!hasEmail(env) || !env.resendApiKey) return null;
  resend ??= new Resend(env.resendApiKey);
  return resend;
}

function noop(mail: Mail): Delivery {
  // Production logs must not carry anyone's address; locally the body is useful.
  if (process.env.NODE_ENV === "production") {
    console.log(`[email:noop] subject="${mail.subject}" (RESEND_API_KEY unset; nothing sent)`);
  } else {
    console.log(`[email:noop] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
  }
  return { sent: false };
}

/** Send one email. */
export async function deliver(mail: Mail): Promise<Delivery> {
  const r = client();
  const from = getEnv().emailFrom;
  if (!r || !from) return noop(mail);
  try {
    const { data, error } = await r.emails.send({ from, ...mail });
    if (error) {
      console.error("[email] resend error:", error);
      return { sent: false };
    }
    return { sent: true, id: data?.id };
  } catch (err) {
    console.error("[email] failed:", err);
    return { sent: false };
  }
}

/** Send many (one per recipient), 100 to a call. The result lines up with `mails`. */
export async function deliverBatch(mails: Mail[]): Promise<Delivery[]> {
  const r = client();
  const from = getEnv().emailFrom;
  if (!r || !from) return mails.map(noop);
  const out: Delivery[] = [];
  for (let i = 0; i < mails.length; i += BATCH) {
    const chunk = mails.slice(i, i + BATCH);
    try {
      const { data, error } = await r.batch.send(chunk.map((m) => ({ from, ...m })));
      if (error || !data) {
        console.error("[email] resend batch error:", error);
        chunk.forEach(() => out.push({ sent: false }));
        continue;
      }
      chunk.forEach((_, k) => out.push({ sent: Boolean(data.data[k]?.id), id: data.data[k]?.id }));
    } catch (err) {
      console.error("[email] batch failed:", err);
      chunk.forEach(() => out.push({ sent: false }));
    }
  }
  return out;
}
