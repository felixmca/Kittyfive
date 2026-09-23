/**
 * Order emails. Sent through src/lib/mail.ts: Resend when RESEND_API_KEY +
 * EMAIL_FROM are set, otherwise a console.log no-op so the flow is visible in
 * dev. Never throws into the webhook: a failed email must not fail a paid order.
 */
import { SITE } from "@/config/site";
import { deliver, esc, wrapHtml } from "@/lib/mail";
import { formatPence } from "./format";
import { describeItems, type OrderItemRow, type OrderRow } from "./orders";
import type { Tracking } from "./types";

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
