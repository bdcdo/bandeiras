-- Tabela única da sincronização: o log de eventos de cada usuário, só de inserção.
-- Aplicar no SQL Editor do painel do Supabase (ou pelo CLI, se instalado). O servidor guarda e devolve eventos; quem
-- interpreta é o núcleo, no navegador. Por isso o payload é opaco (jsonb) e não há update nem delete: zerar o perfil é
-- um evento novo (perfil-reiniciado), nunca uma exclusão.

create table public.eventos (
  usuario_id  text        not null,   -- sub do token do Clerk
  id          text        not null,   -- FNV-1a do conteúdo, gerado pelo núcleo; deduplica a união de logs de dois aparelhos
  em          bigint      not null,   -- ms desde a época, relógio do aparelho
  dispositivo text        not null,
  tipo        text        not null,
  payload     jsonb       not null,   -- o evento inteiro, opaco para o servidor
  recebido_em timestamptz not null default now(),
  primary key (usuario_id, id)
);

-- O cliente recebe por cursor em recebido_em, com margem de 60 s para transação que confirma depois de outra com
-- recebido_em maior; o índice serve a essa consulta.
create index eventos_por_chegada on public.eventos (usuario_id, recebido_em, id);

alter table public.eventos enable row level security;

-- anon não enxerga nada; authenticated só lê e insere as próprias linhas. Sem política nem privilégio de update ou
-- delete, o servidor é só de inserção por construção, não por disciplina do cliente.
revoke all on public.eventos from anon, authenticated;
grant select, insert on public.eventos to authenticated;

create policy "le os proprios" on public.eventos for select to authenticated
  using (usuario_id = (select auth.jwt()->>'sub'));
create policy "insere os proprios" on public.eventos for insert to authenticated
  with check (usuario_id = (select auth.jwt()->>'sub'));
