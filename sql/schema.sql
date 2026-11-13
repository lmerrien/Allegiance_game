-- Allégeance — schéma Supabase (à coller dans SQL Editor). Le service Node utilise la clé service_role: RLS activé sans politique = fermé au public.
create table if not exists games (
  id          text primary key,
  turn        int  not null,
  state       jsonb not null,          -- dumpGame() du moteur (~200 Ko)
  report      jsonb not null default '[]',
  deadline    timestamptz,
  updated_at  timestamptz not null default now()
);
create table if not exists seats (
  game_id     text references games(id) on delete cascade,
  seat        text not null,           -- 'A'..'Z','a'..'z'
  token_hash  text not null,           -- sha256 du jeton remis au joueur
  name        text,
  primary key (game_id, seat)
);
create table if not exists orders (
  game_id     text references games(id) on delete cascade,
  turn        int  not null,
  seat        text not null,
  orders      jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (game_id, turn, seat)
);
alter table games enable row level security;
alter table seats enable row level security;
alter table orders enable row level security;
-- Temps réel (plus tard): le client écoutera games.turn via Supabase Realtime. Pour l'instant il interroge /api/meta.
