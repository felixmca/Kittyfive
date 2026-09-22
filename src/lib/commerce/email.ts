/**
 * Transactional email. Resend when RESEND_API_KEY + EMAIL_FROM are set,
 * otherwise a console.log no-op so the flow is visible in dev. Never throws
 * into the webhook: a failed email must not fail a paid order.
 */
import { Resend } from "resend";
import { SITE } from "@/config/site";
import { getEnv, hasEmail } from "./env";
import { formatPence } from "./format";
import { describeItems, type OrderItemRow, type OrderRow } from "./orders";
import type { Tracking } from "./types";

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let resend: Resend | null = null;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapHtml(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en-GB"><body style="margin:0;background:#0b0b0c;color:#f4f1ea;font-family:Inter,ui-sans-serif,system-ui,sans-serif;padding:32px 16px">
<div style="max-width:520px;margin:0 auto">
<p style="margin:0 0 8px;color:#ffd166;font-size:12px;letter-spacing:.14em;text-transform:uppercase">${esc(SITE.name)}</p>
<h1 style="margin:0 0 20px;font-family:Fraunces,Georgia,serif;font-weight:300;font-size:28px;line-height:1.15">${esc(title)}</h1>
${bodyHtml}
<p style="margin:28px 0 0;color:#9a958c;font-size:13px">${esc(SITE.tagline)} · <a href="${esc(SITE.url)}" style="color:#9a958c">${esc(SITE.url.replace(/^https?:\/\//, ""))}</a></p>
</div></body></html>`;
}

async function deliver(mail: Mail): Promise<{ sent: boolean; id?: string }> {
  const env = getEnv();
  if (!hasEmail(env) || !env.resendApiKey || !env.emailFrom) {
    // Production logs must not carry customer PII; locally the body is useful.
    if (process.env.NODE_ENV === "production") {
      console.log(`[email:noop] subject="${mail.subject}" (RESEND_API_KEY unset; nothing sent)`);
    } else {
      console.log(`[email:noop] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    }
    return { sent: false };
  }
  try {
    resend ??= new Resend(env.resendApiKey);
    const { data, error } = await resend.emails.send({
      from: env.emailFrom,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
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

const KITTY_SAYS = "Kitty says: fine, I suppose.";

export async function sendOrderConfirmation(order: OrderRow, items: OrderItemRow[]): Promise<{ sent: boolean; id?: string }> {
  if (!order.email) return { sent: false };
  const lines = describeItems(items);
  const total = formatPence(order.amount_pence, { currency: order.currency });
  const isSnack = order.kind === "snack";
  const subject = isSnack ? "Kitty got a snack" : `Your Kitty order · ${total}`;
  const greeting = order.name ? `Hello ${order.name.split(/\s+/)[0]},` : "Hello,";
  const snackLine =
    "One pound went to the snack fund. Kitty has been informed and had nothing to say, which is how she says thank you.";

  const itemText = lines
    .map((l) => `  ${l.quantity} x ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""} - ${formatPence(l.unitPence * l.quantity, { currency: order.currency })}`)
    .join("\n");
  const text = isSnack
    ? `${greeting}\n\nThank you. ${snackLine}\n\nReference: ${order.stripe_session_id}\n\n${SITE.tagline}`
    : `${greeting}\n\nThank you for your order.\n\n${itemText}\n  Total (incl. UK tracked shipping): ${total}\n\nWe will email again with tracking once it ships (embroidery and screen-print take a few days).\n\nReference: ${order.stripe_session_id}\n\n${KITTY_SAYS}\n\n${SITE.tagline}`;

  const itemHtml = lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0">${l.quantity} x ${esc(l.name)}${l.variantLabel ? ` <span style="color:#9a958c">${esc(l.variantLabel)}</span>` : ""}</td><td style="padding:6px 0;text-align:right">${esc(formatPence(l.unitPence * l.quantity, { currency: order.currency }))}</td></tr>`,
    )
    .join("");
  const html = wrapHtml(
    isSnack ? "Kitty got a snack." : "Thank you for your order.",
    isSnack
      ? `<p>${esc(greeting)}</p><p>${esc(snackLine)}</p><p style="color:#9a958c;font-size:13px">Reference: ${esc(order.stripe_session_id)}</p>`
      : `<p>${esc(greeting)}</p>
<table style="width:100%;border-collapse:collapse;border-top:1px solid rgba(255,255,255,.16);border-bottom:1px solid rgba(255,255,255,.16);margin:16px 0">${itemHtml}
<tr><td style="padding:10px 0;font-weight:600">Total (incl. UK tracked shipping)</td><td style="padding:10px 0;text-align:right;font-weight:600">${esc(total)}</td></tr></table>
<p>We will email again with tracking once it ships. Embroidery and screen-print take a few days.</p>
<p style="font-family:Fraunces,Georgia,serif;font-style:italic;color:#ffd166">${KITTY_SAYS}</p>
<p style="color:#9a958c;font-size:13px">Reference: ${esc(order.stripe_session_id)}</p>`,
  );
  return deliver({ to: order.email, subject, text, html });
}

export async function sendShippedEmail(order: OrderRow, tracking: Tracking | null): Promise<{ sent: boolean; id?: string }> {
  if (!order.email) return { sent: false };
  const greeting = order.name ? `Hello ${order.name.split(/\s+/)[0]},` : "Hello,";
  const carrier = tracking?.carrier ? ` with ${tracking.carrier}` : "";
  const number = tracking?.number ? `Tracking number: ${tracking.number}` : "";
  const url = tracking?.url ? `Track it: ${tracking.url}` : "";
  const text = `${greeting}\n\nYour Kitty order has shipped${carrier}.\n${[number, url].filter(Boolean).join("\n")}\n\nReference: ${order.stripe_session_id}\n\n${KITTY_SAYS}\n\n${SITE.tagline}`;
  const html = wrapHtml(
    "It has shipped.",
    `<p>${esc(greeting)}</p><p>Your Kitty order has shipped${esc(carrier)}.</p>
${tracking?.number ? `<p>Tracking number: <strong>${esc(tracking.number)}</strong></p>` : ""}
${tracking?.url ? `<p><a href="${esc(tracking.url)}" style="display:inline-block;background:#ffd166;color:#0b0b0c;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px">Track the parcel</a></p>` : ""}
<p style="font-family:Fraunces,Georgia,serif;font-style:italic;color:#ffd166">${KITTY_SAYS}</p>
<p style="color:#9a958c;font-size:13px">Reference: ${esc(order.stripe_session_id)}</p>`,
  );
  return deliver({ to: order.email, subject: "Your Kitty order has shipped", text, html });
}
