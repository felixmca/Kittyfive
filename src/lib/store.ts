"use client";
import { create } from "zustand";

interface UiState {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  cameraOpen: boolean;
  setCameraOpen: (open: boolean) => void;
  productIndex: number;
  setProductIndex: (i: number) => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  toast: string | null;
  showToast: (msg: string, ms?: number) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUi = create<UiState>((set) => ({
  drawerOpen: false,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  cameraOpen: false,
  setCameraOpen: (cameraOpen) => set({ cameraOpen }),
  productIndex: 0,
  setProductIndex: (productIndex) => set({ productIndex }),
  chatOpen: false,
  setChatOpen: (chatOpen) => set({ chatOpen }),
  toast: null,
  showToast: (toast, ms = 2800) => {
    set({ toast });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), ms);
  },
}));

/** Smooth-scroll helpers; SmoothScroll.tsx sets window.__lenis. */
export function scrollToTop() {
  const lenis = (window as unknown as { __lenis?: { scrollTo: (t: number | string, o?: object) => void } }).__lenis;
  if (lenis) lenis.scrollTo(0, { duration: 1.4 });
  else window.scrollTo({ top: 0, behavior: "smooth" });
}

export function scrollToBottom() {
  const lenis = (window as unknown as { __lenis?: { scrollTo: (t: number | string, o?: object) => void } }).__lenis;
  const bottom = document.documentElement.scrollHeight;
  if (lenis) lenis.scrollTo(bottom, { duration: 2 });
  else window.scrollTo({ top: bottom, behavior: "smooth" });
}
