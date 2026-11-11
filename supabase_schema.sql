-- ============================================================================
-- Tales of the White Demon — Schema Supabase (Banco Infinito em Capítulos)
-- Cole e execute este script no SQL Editor do seu projeto Supabase.
-- ============================================================================

create table if not exists public.twd_saves (
  slot_id text primary key,
  core_player jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.twd_spheres (
  slot_id text not null,
  sphere_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (slot_id, sphere_id)
);

create table if not exists public.twd_compendium (
  slot_id text not null,
  category text not null, -- 'npcs' | 'bestiary' | 'concepts'
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (slot_id, category)
);

create table if not exists public.twd_chapters (
  slot_id text not null,
  chapter_id text not null,
  chapter_number integer not null,
  title text not null default '',
  summary text not null default '',
  turns jsonb not null default '[]'::jsonb,
  turn_count integer not null default 0,
  is_closed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (slot_id, chapter_id)
);

create table if not exists public.twd_usage (
  slot_id text not null,
  day_key text not null, -- YYYY-MM-DD
  gemini_requests integer not null default 0,
  gemini_tokens bigint not null default 0,
  supabase_requests integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (slot_id, day_key)
);
-- Custo por modelo do dia ({ "gemini-2.5-pro": {req,in,out}, ... }) — rode também em bancos já criados
alter table public.twd_usage add column if not exists models jsonb not null default '{}'::jsonb;

-- Índices úteis para leitura rápida de capítulos
create index if not exists idx_twd_chapters_slot_num
  on public.twd_chapters (slot_id, chapter_number desc);

-- ============================================================================
-- RLS (Row Level Security)
-- Para uso pessoal rápido via Anon Key (APK/GitHub Pages), deixamos políticas
-- abertas por slot_id secreto escolhido por você nas Configurações do app.
-- Se quiser ainda mais proteção depois, basta trocar para auth.uid().
-- ============================================================================
alter table public.twd_saves enable row level security;
alter table public.twd_spheres enable row level security;
alter table public.twd_compendium enable row level security;
alter table public.twd_chapters enable row level security;
alter table public.twd_usage enable row level security;

drop policy if exists "twd_saves_all" on public.twd_saves;
create policy "twd_saves_all" on public.twd_saves for all using (true) with check (true);

drop policy if exists "twd_spheres_all" on public.twd_spheres;
create policy "twd_spheres_all" on public.twd_spheres for all using (true) with check (true);

drop policy if exists "twd_compendium_all" on public.twd_compendium;
create policy "twd_compendium_all" on public.twd_compendium for all using (true) with check (true);

drop policy if exists "twd_chapters_all" on public.twd_chapters;
create policy "twd_chapters_all" on public.twd_chapters for all using (true) with check (true);

drop policy if exists "twd_usage_all" on public.twd_usage;
create policy "twd_usage_all" on public.twd_usage for all using (true) with check (true);

-- ============================================================================
-- Tabela diferencial de Imagens WebP 9:16 (rode este bloco no SQL Editor)
-- Permite baixar apenas imagens novas ao sincronizar PC <-> Celular.
-- ============================================================================
create table if not exists public.twd_media (
  slot_id text not null,
  media_id text not null,
  webp_data text not null,
  updated_at timestamptz not null default now(),
  primary key (slot_id, media_id)
);

create index if not exists idx_twd_media_updated
  on public.twd_media (slot_id, updated_at desc);

alter table public.twd_media enable row level security;

drop policy if exists "twd_media_all" on public.twd_media;
create policy "twd_media_all" on public.twd_media for all using (true) with check (true);
