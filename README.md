# Cricket Scorer — deployable app

This is the real, standalone version of the cricket scorer — a Vite + React
project you can push to GitHub and deploy on Vercel. It uses
[Supabase](https://supabase.com) (free tier) as a tiny shared database so the
live match and player stats really are visible to everyone who opens the
site, with live updates as the score changes.

## 1. Create a Supabase project (free)

1. Go to https://supabase.com, sign up, and create a new project.
2. Once it's ready, open **SQL Editor → New query**, paste in the contents
   of `supabase-setup.sql` from this folder, and run it. This creates the
   `kv_store` table the app reads/writes and turns on realtime + public
   access (no login needed — anyone with the link can view and score,
   same as before).
3. Go to **Project Settings → API**. You'll need two values from there:
   - **Project URL**
   - **anon public** key

## 2. Configure the app locally

```bash
cp .env.example .env
```

Open `.env` and paste in your Project URL and anon key:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Then install and run it locally to confirm it works:

```bash
npm install
npm run dev
```

Open the printed local URL — you should see the "New Match" setup screen.

## 3. Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel, **Add New → Project**, import that repo. Vercel auto-detects
   Vite — no build settings to change.
3. Before deploying, add the same two environment variables from your `.env`
   file under **Project Settings → Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. That's it — the URL Vercel gives you is now a real, shareable
   cricket scorer.

## Notes

- **Data is public by design.** Anyone with your deployed link can view *and
  edit* the live match and player directory — there's no login. That
  matches how it behaved in chat. If you later want scoring locked to only
  you (with public read-only viewing for everyone else), that needs adding
  real authentication (e.g. Supabase Auth) and tightening the SQL policies
  in `supabase-setup.sql` — let me know if you want that built out.
- The free Supabase tier is plenty for casual use (a few matches, a modest
  player directory). If this ever needs to scale to many concurrent public
  matches, it'd be worth revisiting the data model.
