-- =====================================================================
-- AI Talent Studio · Migration 001
-- Mandanten (Tenants), mandantenbasierte RLS, Mandatswissen mit pgvector
--
-- Läuft komplett in EINER Transaktion: schlägt etwas fehl, ändert sich nichts.
-- Erster Mandant: Personal4U (Owner: vdahm@keyx.de, weitere Logins als Mitglied)
-- Auf Produktion (dxtvsavrezicbucysrdy) ausgeführt am 22.10.2026 über den SQL Editor.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Extension für Vektorsuche (Mandatswissen)
-- ---------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- 2. Mandanten und Mitgliedschaften
-- ---------------------------------------------------------------------
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner','admin','member')),
  created_at  timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on public.tenant_members(user_id);

-- Erster Mandant = Personal4U. vdahm@keyx.de wird Owner,
-- alle weiteren vorhandenen Logins werden Mitglied (behalten ihren Zugriff).
do $$
declare
  v_user   uuid;
  v_tenant uuid;
begin
  select id into v_user from auth.users where email = 'vdahm@keyx.de';
  if v_user is null then
    raise exception 'Login vdahm@keyx.de nicht gefunden – E-Mail in Abschnitt 2 anpassen';
  end if;

  insert into public.tenants (name, slug)
  values ('Personal4U', 'personal4u')
  returning id into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role)
  select v_tenant, u.id, case when u.id = v_user then 'owner' else 'member' end
  from auth.users u;
end $$;

-- ---------------------------------------------------------------------
-- 3. Hilfsfunktionen (security definer, damit RLS nicht rekursiv wird)
-- ---------------------------------------------------------------------
create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid())
  );
$$;

-- Standard-Mandant des eingeloggten Nutzers.
-- Dient als Spalten-Default, damit das bestehende Frontend ohne Änderung weiter einfügen kann.
create or replace function public.default_tenant_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.tenant_id from public.tenant_members m
  where m.user_id = (select auth.uid())
  order by m.created_at
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- 4. tenant_id an den Wurzeltabellen ergänzen und befüllen
--    (Kindtabellen wie role_briefs, batches usw. hängen über search_id dran)
-- ---------------------------------------------------------------------
do $$
declare
  t        text;
  v_tenant uuid := (select id from public.tenants where slug = 'personal4u');
begin
  foreach t in array array['searches','candidates','uploads','hesai_archival_records'] loop
    execute format('alter table public.%I add column tenant_id uuid references public.tenants(id)', t);
    execute format('update public.%I set tenant_id = %L', t, v_tenant);
    execute format('alter table public.%I alter column tenant_id set default public.default_tenant_id()', t);
    execute format('alter table public.%I alter column tenant_id set not null', t);
    execute format('create index %I on public.%I(tenant_id)', t || '_tenant_idx', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Zugriffsfunktionen auf Mandant umstellen
--    Alle Kindtabellen-Policies nutzen diese Funktionen und bleiben unverändert.
-- ---------------------------------------------------------------------
create or replace function public.can_access_search(p_search_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.searches s
    where s.id = p_search_id
      and public.is_tenant_member(s.tenant_id)
  );
$$;

create or replace function public.can_access_search_candidate(p_search_candidate_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.search_candidates sc
    join public.searches s on s.id = sc.search_id
    where sc.id = p_search_candidate_id
      and public.is_tenant_member(s.tenant_id)
  );
$$;

-- ---------------------------------------------------------------------
-- 6. Policies der Wurzeltabellen ersetzen: Mandant statt Einzelnutzer
--    george_threads, george_messages, workspace_state bleiben persönlich.
-- ---------------------------------------------------------------------
do $$
declare
  t   text;
  pol record;
begin
  foreach t in array array['searches','candidates','uploads','hesai_archival_records'] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_tenant_member(tenant_id))
         with check (public.is_tenant_member(tenant_id))',
      t || '_tenant_all', t);
  end loop;
end $$;

-- Mandanten-Tabellen selbst
alter table public.tenants        enable row level security;
alter table public.tenant_members enable row level security;

create policy tenants_member_read on public.tenants
  for select to authenticated using (public.is_tenant_member(id));

create policy tenant_members_self_read on public.tenant_members
  for select to authenticated using (user_id = (select auth.uid()));
-- Mitglieder anlegen/ändern vorerst nur über Dashboard bzw. Backend (service role).

-- ---------------------------------------------------------------------
-- 7. Mandatswissen
--    Annahme: 1536 Dimensionen (z. B. OpenAI text-embedding-3-small).
--    Bei anderem Embedding-Modell vor dem Ausführen anpassen.
-- ---------------------------------------------------------------------
create table public.mandate_knowledge (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.default_tenant_id() references public.tenants(id),
  search_id   uuid not null references public.searches(id) on delete cascade,
  kind        text not null,              -- z. B. brief, feedback, market_insight, client_note, skill_output
  title       text,
  content     text not null,
  source      text,                       -- welcher Skill / welche Quelle
  metadata    jsonb not null default '{}'::jsonb,
  embedding   extensions.vector(1536),
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index mandate_knowledge_search_idx on public.mandate_knowledge(search_id);
create index mandate_knowledge_tenant_idx on public.mandate_knowledge(tenant_id);
create index mandate_knowledge_embedding_idx on public.mandate_knowledge
  using hnsw (embedding extensions.vector_cosine_ops);

create trigger mandate_knowledge_set_updated_at
  before update on public.mandate_knowledge
  for each row execute function public.set_updated_at();

alter table public.mandate_knowledge enable row level security;

create policy mandate_knowledge_tenant_all on public.mandate_knowledge
  for all to authenticated
  using (public.is_tenant_member(tenant_id) and public.can_access_search(search_id))
  with check (public.is_tenant_member(tenant_id) and public.can_access_search(search_id));

-- Ähnlichkeitssuche für Skills: die k relevantesten Einträge eines Mandats
create or replace function public.match_mandate_knowledge(
  p_search_id uuid,
  p_query     extensions.vector(1536),
  p_limit     int default 8
)
returns table (id uuid, kind text, title text, content text, similarity float)
language sql stable security invoker set search_path = ''
as $$
  select k.id, k.kind, k.title, k.content,
         1 - (k.embedding operator(extensions.<=>) p_query) as similarity
  from public.mandate_knowledge k
  where k.search_id = p_search_id and k.embedding is not null
  order by k.embedding operator(extensions.<=>) p_query
  limit p_limit;
$$;

commit;

-- ---------------------------------------------------------------------
-- Kontrolle nach dem Ausführen (optional):
--   select * from public.tenants;
--   select * from public.tenant_members;
--   select tablename, policyname from pg_policies where schemaname='public' order by 1;
-- ---------------------------------------------------------------------
