# Kittyfive

An open-source, phone-first story site for a pet, and a platform for anyone's
pet. The first pet is **Kitty**, a black-and-white cat on the Thames: her life
plays as you swipe, organised like a book (volumes → chapters), with a 3D store
where she shows you the merch and talks back.

- **Stack:** Next.js 16 · React 19 · React Three Fiber · Tailwind 4 · Supabase
  (Postgres, auth, storage) · Claude (chat, chapter drafts) · Stripe · Vercel
- **Live:** https://kittyfive.vercel.app
- Runs fully in **demo mode** with no env vars (or add `?demo=1` to any page).

## Start here

| Doc | What it is |
|---|---|
| [docs/ROADMAP.md](docs/ROADMAP.md) | **The plan.** Phases with checklists; every session starts at the first unchecked box. |
| [docs/HANDOVER-02-OVERNIGHT.md](docs/HANDOVER-02-OVERNIGHT.md) | The current build brief: the swipe-driven landing story. |
| [docs/HANDOVER-01-STORY-ASSETS.md](docs/HANDOVER-01-STORY-ASSETS.md) | The landing story's four chapters: what to generate on artta and where to drop it. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Routes, data model, components, rules. |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Verified research behind the vendor and technique decisions. |
| [docs/SCANNING-GUIDE.md](docs/SCANNING-GUIDE.md), [docs/TRACKING-KITTY.md](docs/TRACKING-KITTY.md) | Later phases. |

## Run

```bash
npm install
npm run dev -- -p 3200
```

`npm run story` turns what is in `assets-raw/` into web frames in `public/`
(it also runs before `dev` and `build`).

## Verify (production build, real phone viewport)

```bash
npm run build
npx next start -p 3201
npm run verify
```

## Configuration

Copy `.env.example` to `.env.local`. For your own copy:

1. Create a Supabase project; apply `supabase/migrations/*` in order; optionally
   run `supabase/seed/kitty.sql` (or your own pet's version of it).
2. Add yourself as an admin in the SQL editor:
   `insert into public.admins (email) values ('you@example.com');`
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the
   publishable key) and, for chat and chapter drafts, `ANTHROPIC_API_KEY`.
4. In Supabase → Authentication → URL Configuration, set your site URL and
   allow `https://<your-site>/**` as a redirect.

Photos, clips and the story's words about Kitty are Felix's and are not covered
by the code's licence (to be chosen; see the roadmap).
