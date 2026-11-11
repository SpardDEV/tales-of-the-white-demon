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

-- ============================================================================
-- FASE 5.5 — Segurança: RLS por dono (Supabase Auth). Rode este bloco por último.
-- 1) Painel → Authentication → Users → "Add user" (e-mail + senha, auto confirm).
-- 2) Painel → Authentication → Sign In / Providers → desligue "Allow new users to sign up".
-- 3) Troque o e-mail abaixo pelo seu e rode tudo. Linhas antigas passam a ser suas.
-- 4) No app: Configurações → Login Supabase → Entrar.
-- ============================================================================
do $$
declare
  t text;
  me uuid := (select id from auth.users where email = 'SEU_EMAIL_AQUI' limit 1);
begin
  if me is null then raise exception 'Crie o usuário em Authentication e troque SEU_EMAIL_AQUI'; end if;
  foreach t in array array['twd_saves','twd_spheres','twd_compendium','twd_chapters','twd_usage','twd_media'] loop
    execute format('alter table public.%I add column if not exists owner uuid default auth.uid()', t);
    execute format('update public.%I set owner = %L where owner is null', t, me);
    execute format('alter table public.%I alter column owner set not null', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid())', t || '_owner', t);
  end loop;
end $$;

-- ============================================================================
-- FASE 5.6 — Webtoon: 60 prompts de página por capítulo
-- [{ page, prompt, characters: [ids do compendium/"player"] }]
-- ============================================================================
alter table public.twd_chapters add column if not exists webtoon_prompts jsonb;

-- ============================================================================
-- FASE 5.8 — Configurações por usuário (carrega APIs/modelos ao logar)
-- Rode este bloco para não precisar reconfigurar Gemini/modelos em outro aparelho.
-- ============================================================================
create table if not exists public.twd_user_settings (
  owner uuid primary key default auth.uid(),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.twd_user_settings enable row level security;

drop policy if exists "twd_user_settings_owner" on public.twd_user_settings;
create policy "twd_user_settings_owner" on public.twd_user_settings
  for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- ============================================================================
-- FASE 6 — RAG Vetorial no Supabase (pgvector + gemini-embedding-001 768d)
-- Rode este bloco quando quiser busca semântica instantânea em meses de capítulos.
-- ============================================================================
create extension if not exists vector;

create table if not exists public.twd_memory_vectors (
  slot_id text not null,
  mem_id text not null,
  kind text not null, -- 'npcs' | 'bestiary' | 'concepts' | 'chapter'
  title text not null default '',
  chapter_number integer,
  content text not null,
  embedding vector(768) not null,
  owner uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (slot_id, mem_id)
);

create index if not exists idx_twd_memory_vectors_hnsw
  on public.twd_memory_vectors using hnsw (embedding vector_cosine_ops);

alter table public.twd_memory_vectors enable row level security;

drop policy if exists "twd_memory_vectors_owner" on public.twd_memory_vectors;
create policy "twd_memory_vectors_owner" on public.twd_memory_vectors
  for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

create or replace function public.match_twd_memory(
  query_embedding vector(768),
  p_slot_id text,
  match_count integer default 6
)
returns table (
  mem_id text,
  kind text,
  title text,
  chapter_number integer,
  content text,
  similarity float
)
language sql
stable
security invoker
as $$
  select
    v.mem_id,
    v.kind,
    v.title,
    v.chapter_number,
    v.content,
    1 - (v.embedding <=> query_embedding) as similarity
  from public.twd_memory_vectors v
  where v.slot_id = p_slot_id
  order by v.embedding <=> query_embedding
  limit greatest(1, least(match_count, 12));
$$;
