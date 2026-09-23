"use client";
/**
 * State private to the store page (the shared cross-page state is in
 * src/lib/store.ts). Updates here happen on events, never per frame.
 */
import { create } from "zustand";
import { PRODUCTS, type Product, type ProductVariant } from "@/config/products";
import { moodAtKittys, type LightMood } from "./ambience";

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
  /** Day or evening in the room: London time at first, then the visitor's choice. */
  lightMood: LightMood;
  setLightMood: (mood: LightMood) => void;
  /**
   * Set the light from London time, once a visit (after hydration: the server
   * cannot know the hour, so the first render is always day).
   */
  initLightMood: () => void;
  lightMoodSet: boolean;
  /** What she says while she has wandered off to look at something (null: nothing). */
  poiLine: string | null;
  setPoiLine: (line: string | null) => void;
  /** Where she is wandering to, for the camera to glance at (null: at her product). */
  wanderTo: [number, number, number] | null;
  setWanderTo: (at: [number, number, number] | null) => void;
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
  lightMood: "day",
  setLightMood: (lightMood) => set({ lightMood, lightMoodSet: true }),
  lightMoodSet: false,
  initLightMood: () => set((s) => (s.lightMoodSet ? s : { lightMood: moodAtKittys(), lightMoodSet: true })),
  poiLine: null,
  setPoiLine: (poiLine) => set({ poiLine }),
  wanderTo: null,
  setWanderTo: (wanderTo) => set({ wanderTo }),
}));

export function selectedVariant(product: Product, variants: Record<string, string>): ProductVariant {
  const id = variants[product.id];
  return product.variants.find((v) => v.id === id) ?? product.variants[0];
}

/**
 * Where Kitty is on the floor, written by <Kitty/> every frame and read by the
 * camera, which turns to follow her while she strolls off on her own (to the
 * window, the garden door, the rug). A plain object, not state: it changes
 * every frame and nothing re-renders from it.
 */
export const kittyTrack = { x: 0, z: 0, strolling: false };
