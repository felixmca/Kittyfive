"use client";
/**
 * State private to the store page (the shared cross-page state is in
 * src/lib/store.ts). Updates here happen on events, never per frame.
 */
import { create } from "zustand";
import { PRODUCTS, type Product, type ProductVariant } from "@/config/products";

interface StoreSliceState {
  /** The product bottom sheet is expanded. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** Selected variant id per product id. */
  variants: Record<string, string>;
  selectVariant: (productId: string, variantId: string) => void;
  /** Product index Kitty is standing at, or null while she walks. */
  arrivedIndex: number | null;
  setArrivedIndex: (index: number | null) => void;
  /** Completed walks. 0 means she has not left her first spot yet. */
  arrivals: number;
  noteArrival: (index: number) => void;
}

export const useStoreState = create<StoreSliceState>((set) => ({
  panelOpen: false,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  variants: Object.fromEntries(PRODUCTS.map((p) => [p.id, p.variants[0]?.id ?? ""])),
  selectVariant: (productId, variantId) =>
    set((s) => ({ variants: { ...s.variants, [productId]: variantId } })),
  arrivedIndex: 0,
  setArrivedIndex: (arrivedIndex) => set({ arrivedIndex }),
  arrivals: 0,
  noteArrival: (index) => set((s) => ({ arrivedIndex: index, arrivals: s.arrivals + 1 })),
}));

export function selectedVariant(product: Product, variants: Record<string, string>): ProductVariant {
  const id = variants[product.id];
  return product.variants.find((v) => v.id === id) ?? product.variants[0];
}
