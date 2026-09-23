/**
 * The three launch products. Prices are in pence. `pod*` fields map each
 * variant to the print-on-demand provider's ids once they exist; until then
 * checkout runs in demo mode and no order is placed.
 */
export type ProductId = "cap" | "hoodie" | "longsleeve";

export interface ProductVariant {
  id: string; // our id, e.g. "hoodie-black-m"
  label: string; // "Black / M"
  colour: string; // css colour for the 3D preview
  size?: string;
  podProductId?: string; // provider product id
  podVariantId?: number; // provider variant id
  stripePriceId?: string; // optional pre-created Stripe Price
}

export interface Product {
  id: ProductId;
  name: string;
  /** What Kitty says when she presents it in the store. */
  pitch: string;
  method: "embroidery" | "screen-print";
  pricePence: number;
  description: string;
  variants: ProductVariant[];
  /** Flat 2D mockups for the store cards + AR try-on. */
  images: { front: string; back?: string; detail?: string };
  /** The 3D model (scripts/store/merch.py) for the living room; its "Fabric" takes the variant's colour. */
  model?: string;
  /** Where the merch sits on a person in AR. */
  anchor: "head" | "torso";
}

export const PRODUCTS: Product[] = [
  {
    id: "cap",
    name: "Kitty Cap",
    pitch: "Check this out. Embroidered, not printed. It's me, on your head.",
    method: "embroidery",
    pricePence: 2800,
    description:
      "Six-panel cotton cap with Kitty's face embroidered on the front. Adjustable strap.",
    variants: [
      { id: "cap-black", label: "Black", colour: "#111111" },
      { id: "cap-stone", label: "Stone", colour: "#cfc6b8" },
    ],
    images: { front: "/products/cap-front.png" },
    model: "/models/merch-cap.glb",
    anchor: "head",
  },
  {
    id: "hoodie",
    name: "Kitty Hoodie",
    pitch: "Heavy, soft, embroidered on the chest. I sleep on the last one they sent.",
    method: "embroidery",
    pricePence: 5500,
    description:
      "Heavyweight brushed-cotton hoodie, small embroidered Kitty on the left chest.",
    variants: [
      { id: "hoodie-black-s", label: "Black / S", colour: "#111111", size: "S" },
      { id: "hoodie-black-m", label: "Black / M", colour: "#111111", size: "M" },
      { id: "hoodie-black-l", label: "Black / L", colour: "#111111", size: "L" },
      { id: "hoodie-black-xl", label: "Black / XL", colour: "#111111", size: "XL" },
    ],
    images: { front: "/products/hoodie-front.png", back: "/products/hoodie-back.png" },
    model: "/models/merch-hoodie.glb",
    anchor: "torso",
  },
  {
    id: "longsleeve",
    name: "Missing Poster Long-Sleeve",
    pitch:
      "The flyer that found me, on a long-sleeve. Screen-printed, so it feels like ink, not plastic.",
    method: "screen-print",
    pricePence: 3800,
    description:
      "Organic cotton long-sleeve with the actual MISSING flyer screen-printed on the back and a small Kitty on the sleeve.",
    variants: [
      { id: "ls-white-s", label: "White / S", colour: "#f4f1ea", size: "S" },
      { id: "ls-white-m", label: "White / M", colour: "#f4f1ea", size: "M" },
      { id: "ls-white-l", label: "White / L", colour: "#f4f1ea", size: "L" },
      { id: "ls-white-xl", label: "White / XL", colour: "#f4f1ea", size: "XL" },
    ],
    images: {
      front: "/products/longsleeve-front.png",
      back: "/products/longsleeve-back.png",
    },
    model: "/models/merch-longsleeve.glb",
    anchor: "torso",
  },
];

export const SHIPPING = {
  /** Flat UK rate in pence, shown at checkout. */
  ukPence: 399,
  countries: ["GB"] as const,
};

/** The £1 snack. Real money, kept apart from any play economy. */
export const SNACK = { pricePence: 100, label: "Give Kitty a snack" };

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function findVariant(
  variantId: string,
): { product: Product; variant: ProductVariant } | undefined {
  for (const product of PRODUCTS) {
    const variant = product.variants.find((v) => v.id === variantId);
    if (variant) return { product, variant };
  }
  return undefined;
}
