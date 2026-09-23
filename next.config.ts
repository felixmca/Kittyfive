import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // three.js + drei ship ESM that Next should bundle rather than externalise.
  transpilePackages: ["three"],
  images: { formats: ["image/avif", "image/webp"] },
  async headers() {
    // When two rules set the same header, the later one wins.
    return [
      {
        // Stills, extras, the chat, the flyer, mockups, models: an hour, then
        // refreshed in the background. Not "immutable": these keep their names
        // when replaced, and a 404 (the flyer before it exists) must not stick.
        source: "/(story|turntable|products|models)/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=604800" }],
      },
      {
        // Which chapters have clips, and each clip's frame count and version:
        // asked again on every visit, so a new or re-cut clip shows at once.
        source: "/(story|turntable)/(.*)\\.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        // Clip frames (0001.webp …) are requested as ?v=<the manifest's
        // builtAt>, so a re-cut clip has new URLs: these can be kept forever.
        source: "/story/(.*)/(\\d{4})\\.webp",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/turntable/(\\d{4})\\.webp",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
