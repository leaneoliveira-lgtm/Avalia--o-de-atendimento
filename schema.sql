-- ============================================================
-- Sistema de Avaliação de Atendimentos Internos
-- Schema para Supabase (PostgreSQL)
-- Execute este script inteiro no SQL Editor do seu projeto Supabase
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Colaboradores (atendentes avaliados)
-- ------------------------------------------------------------
create table if not exists colaboradores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  setor text,
  cargo text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Critérios de avaliação de qualidade
-- ------------------------------------------------------------
create table if not exists criterios_avaliacao (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  peso numeric not null default 1 check (peso > 0),
  tipo_atendimento text not null default 'ambos'
    check (tipo_atendimento in ('chat','ligacao','ambos')),
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Atendimentos avaliados
-- ------------------------------------------------------------
create table if not exists atendimentos (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid references colaboradores(id) on delete set null,
  avaliador text not null,
  tipo_atendimento text not null check (tipo_atendimento in ('chat','ligacao')),
  data_atendimento date not null,
  cliente text,
  protocolo text,
  placa text,
  duracao_minutos numeric,
  observacoes text,
  nota_final numeric,
  sla_cumprido boolean,
  csat numeric check (csat is null or (csat >= 0 and csat <= 10)),
  created_at timestamptz not null default now()
);

create index if not exists idx_atendimentos_colaborador on atendimentos(colaborador_id);
create index if not exists idx_atendimentos_data on atendimentos(data_atendimento);
create index if not exists idx_atendimentos_placa on atendimentos(placa);

-- ------------------------------------------------------------
-- Observação do supervisor por colaborador (Relatório de Desempenho)
-- Um registro por colaborador, atualizado/editado ao longo do tempo.
-- ------------------------------------------------------------
create table if not exists relatorio_observacoes (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null unique references colaboradores(id) on delete cascade,
  observacao text,
  autor text,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Notas atribuídas por critério em cada atendimento
-- ------------------------------------------------------------
create table if not exists avaliacoes_criterios (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references atendimentos(id) on delete cascade,
  criterio_id uuid not null references criterios_avaliacao(id) on delete restrict,
  nota numeric not null check (nota >= 0 and nota <= 10),
  comentario text
);

create index if not exists idx_avaliacoes_atendimento on avaliacoes_criterios(atendimento_id);

-- ------------------------------------------------------------
-- Row Level Security
-- ATENÇÃO: as policies abaixo liberam acesso total (uso interno
-- com a chave anon). Ajuste conforme a autenticação real da
-- empresa (ex.: restringir por auth.uid() / papel do usuário)
-- antes de colocar em produção com dados sensíveis.
-- ------------------------------------------------------------
alter table colaboradores enable row level security;
alter table criterios_avaliacao enable row level security;
alter table atendimentos enable row level security;
alter table avaliacoes_criterios enable row level security;
alter table relatorio_observacoes enable row level security;

create policy "acesso total colaboradores" on colaboradores
  for all using (true) with check (true);
create policy "acesso total criterios" on criterios_avaliacao
  for all using (true) with check (true);
create policy "acesso total relatorio_observacoes" on relatorio_observacoes
  for all using (true) with check (true);
create policy "acesso total atendimentos" on atendimentos
  for all using (true) with check (true);
create policy "acesso total avaliacoes" on avaliacoes_criterios
  for all using (true) with check (true);

-- ------------------------------------------------------------
-- Critérios padrão (pode editar/adicionar pela própria interface)
-- ------------------------------------------------------------
insert into criterios_avaliacao (nome, descricao, peso, tipo_atendimento, ordem) values
('Saudação e abertura', 'Cumprimentou o cliente de forma cordial e se identificou corretamente', 1, 'ambos', 1),
('Escuta ativa', 'Demonstrou compreensão real da demanda do cliente', 1.5, 'ambos', 2),
('Clareza na comunicação', 'Usou linguagem clara, objetiva e adequada ao cliente', 1.5, 'ambos', 3),
('Conhecimento técnico', 'Demonstrou domínio sobre o produto, serviço ou processo', 2, 'ambos', 4),
('Cordialidade e empatia', 'Manteve tom respeitoso e empático durante todo o atendimento', 1.5, 'ambos', 5),
('Resolução do problema', 'Solucionou ou encaminhou corretamente a demanda do cliente', 2.5, 'ambos', 6),
('Tempo de resposta', 'Respondeu às mensagens em tempo adequado', 1, 'chat', 7),
('Postura ao telefone', 'Tom de voz, dicção e postura profissional na ligação', 1, 'ligacao', 7),
('Encerramento', 'Confirmou a resolução e encerrou o atendimento adequadamente', 1, 'ambos', 8)
on conflict do nothing;
