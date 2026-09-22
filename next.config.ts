import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // three.js + drei ship ESM that Next should bundle rather than externalise.
  transpilePackages: ["three"],
  images: { formats: ["image/avif", "image/webp"] },
  async headers() {
    return [
      {
        // Story frames and turntable images are immutable once built.
        source: "/(story|turntable|products|models)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
