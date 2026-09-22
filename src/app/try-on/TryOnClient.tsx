"use client";
/**
 * Client shell for /try-on: the site chrome plus the camera try-on, loaded
 * client-only (it touches getUserMedia, canvas and WebGL) and wrapped in an
 * error boundary so a failure inside never leaves a blank page.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import Chrome from "@/components/chrome/Chrome";
import ArErrorBoundary from "@/components/ar/ArErrorBoundary";

const TryOn = dynamic(() => import("@/components/ar/TryOn"), {
  ssr: false,
  loading: () => <TryOnSkeleton />,
});

function TryOnSkeleton() {
  return (
    <div className="fixed inset-0 grid place-items-center bg-[#0b0b0c] px-6 text-center text-[#f4f1ea]">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#ffd166]">Kitty · Try it on</p>
        <p className="font-display mt-2 text-3xl">Put Kitty on.</p>
        <p className="mt-3 text-sm text-[#9a958c]">Warming up the camera view…</p>
      </div>
    </div>
  );
}

function TryOnCrashed() {
  return (
    <div className="fixed inset-0 grid place-items-center bg-[#0b0b0c] px-6 text-center text-[#f4f1ea]">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#ffd166]">Kitty · Try it on</p>
        <p className="font-display mt-2 text-3xl">The camera view couldn&apos;t start here.</p>
        <p className="mt-3 text-sm text-[#9a958c]">Nothing was uploaded. The store still works.</p>
        <Link
          href="/store"
          className="glass mt-6 inline-flex h-12 items-center justify-center rounded-full px-6 text-sm font-medium"
        >
          Go to the store
        </Link>
      </div>
    </div>
  );
}

export default function TryOnClient() {
  return (
    <>
      <Chrome />
      <ArErrorBoundary label="TryOn" fallback={<TryOnCrashed />}>
        <TryOn />
      </ArErrorBoundary>
    </>
  );
}
