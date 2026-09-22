"use client";
/**
 * Designed stand-in for the 3D room: shown while the scene bundle loads and
 * when WebGL is unavailable. A gradient room, a pale river-lit window and a
 * cat silhouette, so the page is never a blank rectangle.
 */
interface Props {
  variant: "loading" | "unsupported";
}

export default function ScenePlaceholder({ variant }: Props) {
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 70% at 50% 100%, #3a2718 0%, #1b1512 45%, #0b0b0c 100%)",
      }}
    >
      {/* Window with river light */}
      <div
        className="absolute left-1/2 top-[22%] h-[26%] w-[46%] -translate-x-1/2 rounded-sm"
        style={{
          background: "linear-gradient(180deg, #d6e8ff 0%, #9fc4ee 100%)",
          boxShadow: "0 0 80px 30px rgba(188, 216, 255, 0.18)",
          border: "6px solid #3a332c",
        }}
      />
      {/* Floor line */}
      <div className="absolute inset-x-0 top-[62%] h-px bg-white/10" />
      {/* Cat silhouette sat on the floor */}
      <svg
        viewBox="0 0 120 80"
        className="absolute left-1/2 top-[52%] w-[34%] -translate-x-1/2"
        role="img"
        aria-label="Kitty, sitting"
      >
        <path
          d="M30 70 C24 50 30 34 46 30 L44 14 L56 26 L70 26 L82 14 L80 30 C96 36 100 52 92 70 Z"
          fill="#15151a"
        />
        <path d="M88 66 C104 60 108 44 100 38 C110 48 106 66 90 72 Z" fill="#15151a" />
        <ellipse cx="63" cy="66" rx="12" ry="6" fill="#f4f1ea" opacity="0.9" />
        <circle cx="55" cy="38" r="2.4" fill="#7dc56f" />
        <circle cx="71" cy="38" r="2.4" fill="#7dc56f" />
      </svg>
      <p className="absolute inset-x-6 top-[78%] text-center text-sm text-muted">
        {variant === "loading"
          ? "Kitty is finding her spot…"
          : "This browser cannot draw Kitty's living room. The products and the chat still work below."}
      </p>
    </div>
  );
}
