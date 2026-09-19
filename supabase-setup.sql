-- Run this once in your Supabase project's SQL editor (Project > SQL Editor > New query).

create table if not exists kv_store (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table kv_store enable row level security;

-- This app has no login system — match/player data is meant to be publicly
-- readable and writable by anyone with the link, matching the "shared, live,
-- watchable by anyone" behavior it had as a Claude artifact. If you want to
-- lock down who can *write* (not just watch), replace these two policies
-- with ones that check auth.uid() once you add real authentication.
create policy "public read" on kv_store for select using (true);
create policy "public write" on kv_store for insert with check (true);
create policy "public update" on kv_store for update using (true);
create policy "public delete" on kv_store for delete using (true);

-- Enable realtime so every open browser tab gets live updates.
alter publication supabase_realtime add table kv_store;
