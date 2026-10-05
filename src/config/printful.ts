/**
 * Printful blueprints: which catalog product each Kitty product is made on,
 * which catalog variant each of OUR variants is, and the print file for every
 * placement. This is the part of the Printful wiring that needs no store yet.
 *
 * Two things read it:
 *   - scripts/printful.mjs `products sync` creates (or updates) the three sync
 *     products in the Printful store from these blueprints and writes the
 *     resulting store ids to src/config/pod-ids.json.
 *   - src/lib/commerce/pod/types.ts mapItemsToPod() falls back to ordering the
 *     CATALOG variant directly (variant_id + files) when a variant has no
 *     store ids yet, so fulfilment works the moment PRINTFUL_STORE_ID exists.
 *
 * Verified against GET https://api.printful.com/products/{id} on 5 Oct 2026:
 * every variant below is availability_status UK: in_stock. Catalog prices are
 * USD base costs (cap 17.95, hoodie 24.25, long-sleeve 18.75; left-chest
 * embroidery +2.95; a back print +5.95; a sleeve print +5.95).
 *
 * Thread colours are Printful's fixed embroidery palette (option values must
 * be from this list): #FFFFFF 1801 White, #000000 1800 Black, #96A1A8 1718
 * Grey, #A67843 1672 Old Gold, #FFCC00 1951 Gold, #E25C27 1987 Orange,
 * #CC3366 1910 Flamingo, #CC3333 1839 Red, #660000 1784 Maroon, #333366 1966
 * Navy, #005397 1842 Royal, #3399FF 1695 Aqua/Teal, #6B5294 1832 Purple,
 * #01784E 1751 Kelly Green, #7BA35A 1848 Kiwi Green.
 */
import type { ProductId } from "./products";

export interface PrintfulOption {
  id: string;
  value: string | string[] | number | boolean;
}

export interface PrintfulPlacement {
  /** Printful placement key, sent as the file "type". */
  placement: string;
  /** Site-relative path under public/ (scripts/print-files.mjs writes them); Printful fetches NEXT_PUBLIC_SITE_URL + path. */
  file: string;
  /**
   * How much of the placement area the design should fill, as a fraction of
   * the area's width or height. `products sync` reads the area size from
   * GET /mockup-generator/printfiles/{id} and turns this into a `position`;
   * a catalog order sends no position and Printful fits the design itself.
   */
  fit?: { width?: number; height?: number; align?: "top" | "centre" };
}

export interface PrintfulBlueprint {
  productId: ProductId;
  /** sync_product.external_id: makes `products sync` idempotent. */
  externalId: string;
  /** Name of the product inside Printful. */
  name: string;
  catalogProductId: number;
  /** Brand and model, for humans and for the catalog check. */
  catalogModel: string;
  technique: "EMBROIDERY" | "DTG";
  placements: PrintfulPlacement[];
  /** Item-level options (embroidery type, thread colours per placement). */
  options?: PrintfulOption[];
  /** Our variant id (src/config/products.ts) → Printful catalog variant id. */
  variants: Record<string, number>;
}

export const THREAD = {
  white: "#FFFFFF",
  black: "#000000",
  grey: "#96A1A8",
  gold: "#FFCC00",
  flamingo: "#CC3366",
} as const;

/** Kitty's face in the five threads it needs: black fur, white bib, grey whiskers/mouth, gold eyes, pink ears and nose. */
const FACE_THREADS = [THREAD.black, THREAD.white, THREAD.grey, THREAD.gold, THREAD.flamingo];

export const PRINT_FILES = {
  /** Flat-colour face for embroidery (cap front, hoodie left chest). */
  faceEmbroidery: "/print/kitty-face-embroidery.png",
  /** One-colour black ink face for the long-sleeve's sleeve. */
  faceInk: "/print/kitty-face-ink.png",
  /** The MISSING flyer, black ink only, for the long-sleeve's back. */
  flyerBack: "/print/missing-flyer-back.png",
} as const;

export const PRINTFUL_BLUEPRINTS: PrintfulBlueprint[] = [
  {
    productId: "cap",
    externalId: "kitty-cap",
    name: "Kitty Cap",
    catalogProductId: 206,
    catalogModel: "Yupoong 6245CM Classic Dad Hat",
    technique: "EMBROIDERY",
    // Dad-hat front embroidery area is 4" × 1.75"; the square face fits the height.
    placements: [{ placement: "embroidery_front", file: PRINT_FILES.faceEmbroidery, fit: { height: 0.95, align: "centre" } }],
    options: [
      { id: "embroidery_type", value: "flat" },
      { id: "thread_colors", value: FACE_THREADS },
    ],
    variants: {
      "cap-black": 7854,
      "cap-stone": 7859,
    },
  },
  {
    productId: "hoodie",
    externalId: "kitty-hoodie",
    name: "Kitty Hoodie",
    catalogProductId: 146,
    catalogModel: "Gildan 18500 Unisex Heavy Blend Hoodie",
    technique: "EMBROIDERY",
    // Left chest area is 4" × 4"; a "small embroidered Kitty" is about 2.5".
    placements: [{ placement: "embroidery_chest_left", file: PRINT_FILES.faceEmbroidery, fit: { width: 0.62, align: "centre" } }],
    options: [{ id: "thread_colors_chest_left", value: FACE_THREADS }],
    variants: {
      "hoodie-black-s": 5530,
      "hoodie-black-m": 5531,
      "hoodie-black-l": 5532,
      "hoodie-black-xl": 5533,
    },
  },
  {
    productId: "longsleeve",
    externalId: "kitty-longsleeve",
    name: "Missing Poster Long-Sleeve",
    catalogProductId: 356,
    catalogModel: "Bella + Canvas 3501 Unisex Long Sleeve Tee",
    // Kornit water-based DTG (the catalog's default technique for 3501), never DTF.
    technique: "DTG",
    placements: [
      { placement: "back", file: PRINT_FILES.flyerBack, fit: { height: 0.92, align: "top" } },
      { placement: "sleeve_left", file: PRINT_FILES.faceInk, fit: { width: 0.7, align: "centre" } },
    ],
    variants: {
      "ls-white-s": 10142,
      "ls-white-m": 10143,
      "ls-white-l": 10144,
      "ls-white-xl": 10145,
    },
  },
];

export function printfulBlueprintFor(productId: string): PrintfulBlueprint | undefined {
  return PRINTFUL_BLUEPRINTS.find((b) => b.productId === productId);
}

/** The blueprint and catalog variant id for one of our variant ids, if the product has a blueprint. */
export function printfulCatalogVariant(variantId: string): { blueprint: PrintfulBlueprint; catalogVariantId: number } | undefined {
  for (const blueprint of PRINTFUL_BLUEPRINTS) {
    const catalogVariantId = blueprint.variants[variantId];
    if (typeof catalogVariantId === "number") return { blueprint, catalogVariantId };
  }
  return undefined;
}
