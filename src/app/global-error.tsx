"use client";
/**
 * The last resort, when even the root layout fails: plain HTML with inline
 * styles (no stylesheet can be assumed), a retry and the way home.
 */
export default function GlobalError() {
  return (
    <html lang="en-GB">
      <body style={{ margin: 0, background: "#0b0b0c", color: "#f4f1ea", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 520, margin: "0 auto", padding: "30vh 24px 0" }}>
          <p style={{ color: "#ffd166", fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", margin: 0 }}>Kitty</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 300, fontSize: 36, lineHeight: 1.1, margin: "8px 0 16px" }}>
            Something fell off the shelf.
          </h1>
          <p style={{ color: "#9a958c", fontSize: 16, lineHeight: 1.5 }}>The page didn&apos;t load. Trying again tends to work.</p>
          <p style={{ marginTop: 28, display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ background: "#ffd166", color: "#141414", border: 0, borderRadius: 999, padding: "12px 22px", fontSize: 16 }}
            >
              Try again
            </button>
            {/* A plain link on purpose: the router may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ color: "#f4f1ea", border: "1px solid rgba(255,255,255,.15)", borderRadius: 999, padding: "12px 22px", textDecoration: "none" }}>
              Home
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
