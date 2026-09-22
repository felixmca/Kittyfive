# Kitty

A phone-first 3D story-and-merch site for a black-and-white cat called Kitty.
Scroll her life, spin the real cat, step into her living room, buy the cap.

- **Stack:** Next.js 16 · React 19 · React Three Fiber · GSAP ScrollTrigger + Lenis · Tailwind 4 · Supabase · Stripe · Claude
- **Hosting:** Vercel (site) + Supabase (orders). Runs fully in **demo mode** with no env vars.

## Start here

| Doc | What it is |
|---|---|
| [docs/HANDOVER-01-STORY-ASSETS.md](docs/HANDOVER-01-STORY-ASSETS.md) | **Do this first.** What to photograph, the artta.ai prompts per scene, where to drop the files. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases, locked decisions, costs, what needs you. |
| [docs/SCANNING-GUIDE.md](docs/SCANNING-GUIDE.md) | Photographing the living room + garden for the 3D store. |
| [docs/TRACKING-KITTY.md](docs/TRACKING-KITTY.md) | AirTag answer and the beacon architecture. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Component ownership, routes, state, asset slots. |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Verified research behind every decision. |

## Run

```bash
npm install
npm run dev -- -p 3200
```

Drop clips per the handover, then:

```bash
npm run story
```

## Verify (production build, real phone viewport)

```bash
npm run build
npx next start -p 3201
npm run verify
```

Screenshots land in `.verify/`.

## Configuration

Copy `.env.example` to `.env.local`. With nothing set, checkout returns a demo
page, chat answers in character from canned lines, and a DEMO banner shows.
Every fact a non-developer edits lives in `src/config/`.
