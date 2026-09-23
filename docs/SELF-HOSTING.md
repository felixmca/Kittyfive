# Running your own Kittyfive

Kittyfive is built around one pet at a time: today that pet is Kitty. This
guide gets a copy of the site running for **your** pet: first on your
computer with no accounts at all, then live on Vercel with Supabase behind it.
Signing up many pets on one site is Phase 7 of the [roadmap](ROADMAP.md).

Kitty's photos, clips and the words about her belong to Felix and are not
part of the code's licence. Replace them with your own (step 5).

## 1 · On your computer, no accounts (five minutes)

You need Node 22 or newer and git.

```bash
git clone https://github.com/felixmca/Kittyfive.git
cd Kittyfive
npm install
npm run dev
```

Open http://localhost:3000. With no settings the whole site runs in **demo
mode**: the stories come from `src/config/stories.ts`, sign-in is pretend
(any email and password), and everything you edit lives in your browser. The
store, the try-on and the chapter builder all work; the chat answers with
canned lines, and checkout is a pretend one.

## 2 · Supabase (the database, sign-in and photo storage)

1. Create a project at [supabase.com](https://supabase.com) (the free plan is
   enough to start; it pauses after a week without visits).
2. In the SQL editor, run every file in `supabase/migrations/` **in name
   order**. Or, with the Supabase CLI linked to the project,
   `supabase db push`. They create the tables, the row level security that
   decides who may do what, the `story-media` storage bucket, and the checked
   functions that do every sensitive write.
3. Add your pet. Copy `supabase/seed/kitty.sql`, change the pet (slug, name,
   tagline) and the volumes and chapters to your own, and run it. It is safe
   to run again after edits.
4. Make yourself an admin (admins can edit every pet):
   ```sql
   insert into public.admins (email) values ('you@example.com');
   ```
   It only counts once you have signed up with that address and confirmed it.
5. Authentication → URL Configuration: set **Site URL** to your site's
   address and add `https://<your-site>/**` to the redirect URLs (the
   confirmation and password-reset links come back to `/account`).
6. Check the rules hold: `node scripts/db.mjs supabase/tests/rls-smoke.sql`
   (with `SUPABASE_DB_URL` in `.env.local`, see below). It pretends to be a
   stranger, an unconfirmed address and an admin, checks what each can do,
   and rolls everything back.

## 3 · Settings

Copy `.env.example` to `.env.local` for your computer; put the same names in
Vercel → Settings → Environment Variables for the live site.

| Setting | What it switches on |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Real accounts, stories from the database, photo uploads. Both are public by design; row level security is the gate. |
| `NEXT_PUBLIC_SITE_URL` | Your site's address, for links in emails and share cards. |
| `ANTHROPIC_API_KEY` | The store's chat and the chapter builder (Claude). |
| `RESEND_API_KEY`, `EMAIL_FROM` | Order emails and "new chapter" emails. Resend needs a domain you own and have verified; `vercel.app` addresses cannot send. |
| `RESEND_WEBHOOK_SECRET` | Addresses that bounce or complain stop getting story emails (with the service role key). |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Orders written by the Stripe webhook, and bounce handling. Never put it in a `NEXT_PUBLIC_` name. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Real checkout. With `supabase/commerce.sql` run once. |
| `PRINTFUL_*` (or `PRINTIFY_*`) | Orders go to print on demand. |
| `SUPABASE_DB_URL` | Only on your computer, for `scripts/db.mjs` (the session pooler address from Supabase → Connect). |

Anything left empty stays in its demo or "off" state and says so on the
page; nothing breaks.

## 4 · Live on Vercel

1. Push your copy to GitHub and import it in Vercel. Keep `vercel.json` as it
   is (it pins the Next.js preset and the Frankfurt region, next to a
   Supabase project in eu-central-1; change `regions` to be near yours).
2. Add the settings from step 3 and deploy. Every push to `main` deploys.
3. Sign up on the live site with the admin address from step 2.4 and confirm
   it. The menu then shows **Admin**, and **Edit** appears on `/stories`.

Before your store takes real money, check the plans: Vercel's Hobby plan and
Supabase's free plan do not allow commercial use or pause when idle
([roadmap, Phase 6](ROADMAP.md)).

## 5 · Make it your pet's

- `src/config/site.ts`: the name, tagline, address and `petSlug` (must match
  the slug you seeded).
- `src/config/kitty.ts`: who the chat speaks as. Most of the voice is then
  tuned without code on `/admin` → Kitty Tunables.
- `src/config/products.ts`: the store's products and prices.
- The landing story: `src/config/story.ts` and the clips under
  `public/story/` (see [Handover 01](HANDOVER-01-STORY-ASSETS.md) for how
  Kitty's were made, and `npm run story` to cut clips into frames).
- Chapters on `/stories` are made on the site itself: **Edit**, then **+** in
  a volume, then photos and a few sentences.

## 6 · Check it

```bash
npm run build
npm run start -- -p 3201
npm run verify
```

`verify` walks every page on phone and computer sizes in Chrome's engine and
in Safari's (WebKit, as an iPhone), in demo mode, and never writes to your
database. Add `-- --base=https://<your-site>` to check the live one.
