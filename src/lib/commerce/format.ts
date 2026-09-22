/**
 * Money formatting shared by server pages and client buttons. No imports from
 * the rest of lib/commerce so client components can use it safely.
 */
export function formatPence(
  pence: number,
  opts: { currency?: string; locale?: string; compact?: boolean } = {},
): string {
  const currency = (opts.currency ?? "GBP").toUpperCase();
  const locale = opts.locale ?? "en-GB";
  const whole = Number.isInteger(pence / 100);
  const fractionDigits = opts.compact && whole ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(pence / 100);
  } catch {
    const symbol = currency === "GBP" ? "£" : `${currency} `;
    return `${symbol}${(pence / 100).toFixed(fractionDigits)}`;
  }
}
