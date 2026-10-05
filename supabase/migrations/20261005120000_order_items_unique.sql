-- One line per variant per order. Two Stripe deliveries of the same event a
-- few milliseconds apart could both insert the order's items (the second one
-- reads an empty list before the first insert lands), and the print provider
-- would then be sent double quantities. With this key the code upserts the
-- items with ignoreDuplicates (src/lib/commerce/orders.ts ensureOrderItems /
-- insertOrderIdempotent), so the second insert is a no-op. Safe to re-run.
create unique index if not exists order_items_order_variant_key
  on public.order_items (order_id, variant_id);
