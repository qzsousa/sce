-- ============================================================
-- SCE - SISTEMA DE CONTROLE DE EQUIPAMENTOS
-- Schema completo para Supabase (PostgreSQL)
-- Execute TODO este script no SQL Editor do Supabase
-- ============================================================

-- Habilitar extensão UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE nivel_usuario AS ENUM ('Matriz', 'AdminFilial', 'Filial', 'Tecnico');
CREATE TYPE status_usuario AS ENUM ('Ativo', 'Removido');
CREATE TYPE status_equipamento AS ENUM (
  'Disponível', 'Manutenção', 'Emprestado', 'Extraviado',
  'Inservível', 'Em verificação', 'Quebrado', 'Removido'
);
CREATE TYPE status_manutencao AS ENUM ('Pendente', 'Em andamento', 'Concluído');
CREATE TYPE status_emprestimo AS ENUM ('Emprestado', 'Devolvido');
CREATE TYPE tipo_emprestimo AS ENUM ('interno', 'interestadual');

-- ============================================================
-- TABELA: usuarios
-- ============================================================
CREATE TABLE usuarios (
  email          TEXT PRIMARY KEY,
  nome           TEXT NOT NULL,
  nivel          nivel_usuario NOT NULL DEFAULT 'Filial',
  filial         TEXT NOT NULL,
  status         status_usuario NOT NULL DEFAULT 'Ativo',
  data_remocao   TIMESTAMPTZ,
  senha_definida BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Para bancos já existentes, aplicar a migração abaixo:
-- ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_definida BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX idx_usuarios_nivel ON usuarios(nivel);
CREATE INDEX idx_usuarios_filial ON usuarios(filial);
CREATE INDEX idx_usuarios_status ON usuarios(status);

-- ============================================================
-- TABELA: equipamentos
-- ============================================================
CREATE TABLE equipamentos (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  unidade                     TEXT NOT NULL,
  categoria                   TEXT NOT NULL,
  marca                       TEXT NOT NULL,
  modelo                      TEXT NOT NULL,
  patrimonio                  TEXT,
  numero_serie                TEXT,
  status                      status_equipamento NOT NULL DEFAULT 'Disponível',
  status_manutencao           status_manutencao,
  vinculado_blue_monitor      TEXT NOT NULL DEFAULT 'Não' CHECK (vinculado_blue_monitor IN ('Sim', 'Não')),
  numero_chamado_manutencao   TEXT,
  boletim_ocorrencia          TEXT,
  justificativa_verificacao   TEXT,
  descricao_quebrado          TEXT,
  sistema_operacional         TEXT,
  processador                 TEXT,
  memoria_ram                 TEXT,
  armazenamento               TEXT,
  tamanho_tela                TEXT,
  responsavel_atual           TEXT,
  observacoes                 TEXT,
  data_cadastro               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_ultima_atualizacao     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cadastrado_por              TEXT NOT NULL REFERENCES usuarios(email),
  ultima_alteracao_por        TEXT REFERENCES usuarios(email),
  justificativa_patrimonio    TEXT,
  justificativa_numero_serie  TEXT,
  boletim_ocorrencia_anexo_url TEXT,
  tipo_emprestimo             tipo_emprestimo,
  escola_destino              TEXT
);

-- Índices únicos parciais (sintaxe correta: CREATE UNIQUE INDEX ... WHERE)
CREATE UNIQUE INDEX idx_equipamentos_patrimonio_unique 
  ON equipamentos(patrimonio) WHERE patrimonio IS NOT NULL;

CREATE UNIQUE INDEX idx_equipamentos_numero_serie_unique 
  ON equipamentos(numero_serie) WHERE numero_serie IS NOT NULL;

-- Índices normais
CREATE INDEX idx_equipamentos_unidade ON equipamentos(unidade);
CREATE INDEX idx_equipamentos_status ON equipamentos(status);
CREATE INDEX idx_equipamentos_categoria ON equipamentos(categoria);
CREATE INDEX idx_equipamentos_cadastrado_por ON equipamentos(cadastrado_por);

-- ============================================================
-- TABELA: listas (categoria, marca, modelo)
-- ============================================================
CREATE TABLE listas (
  id          BIGSERIAL PRIMARY KEY,
  categoria   TEXT NOT NULL,
  marca       TEXT NOT NULL,
  modelo      TEXT NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (categoria, marca, modelo)
);

CREATE INDEX idx_listas_categoria ON listas(categoria);
CREATE INDEX idx_listas_marca ON listas(marca);

-- ============================================================
-- TABELA: filiais (para dropdown de empréstimo inter-escolar)
-- ============================================================
CREATE TABLE filiais (
  id        BIGSERIAL PRIMARY KEY,
  nome      TEXT NOT NULL UNIQUE,
  ativo     BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: historico_itens
-- ============================================================
CREATE TABLE historico_itens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipamento_id  UUID NOT NULL REFERENCES equipamentos(id) ON DELETE CASCADE,
  campo           TEXT NOT NULL,
  valor_antigo    TEXT,
  valor_novo      TEXT,
  autor           TEXT NOT NULL REFERENCES usuarios(email),
  data            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_historico_equipamento ON historico_itens(equipamento_id);
CREATE INDEX idx_historico_data ON historico_itens(data DESC);

-- ============================================================
-- TABELA: emprestimos
-- ============================================================
CREATE TABLE emprestimos (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipamento_id          UUID NOT NULL REFERENCES equipamentos(id) ON DELETE CASCADE,
  patrimonio              TEXT NOT NULL,
  unidade                 TEXT NOT NULL,
  responsavel             TEXT NOT NULL,
  cpf                     TEXT,
  email_responsavel       TEXT,
  data_emprestimo         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_prevista_devolucao DATE,
  data_devolucao          TIMESTAMPTZ,
  status                  status_emprestimo NOT NULL DEFAULT 'Emprestado',
  termo_pdf_url           TEXT,
  criado_por              TEXT NOT NULL REFERENCES usuarios(email),
  devolvido_por           TEXT REFERENCES usuarios(email),
  observacoes             TEXT,
  tipo_emprestimo         tipo_emprestimo NOT NULL DEFAULT 'interno',
  escola_destino          TEXT
);

CREATE INDEX idx_emprestimos_equipamento ON emprestimos(equipamento_id);
CREATE INDEX idx_emprestimos_status ON emprestimos(status);
CREATE INDEX idx_emprestimos_data_emprestimo ON emprestimos(data_emprestimo DESC);

-- ============================================================
-- TABELA: auditoria
-- ============================================================
CREATE TABLE auditoria (
  id        BIGSERIAL PRIMARY KEY,
  data      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  usuario   TEXT NOT NULL REFERENCES usuarios(email),
  acao      TEXT NOT NULL,
  detalhes  JSONB
);

CREATE INDEX idx_auditoria_usuario ON auditoria(usuario);
CREATE INDEX idx_auditoria_acao ON auditoria(acao);
CREATE INDEX idx_auditoria_data ON auditoria(data DESC);

-- ============================================================
-- TABELA: registros_manutencao
-- ============================================================
CREATE TABLE registros_manutencao (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipamento_id  UUID NOT NULL REFERENCES equipamentos(id) ON DELETE CASCADE,
  autor           TEXT NOT NULL REFERENCES usuarios(email),
  data            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  descricao       TEXT NOT NULL,
  status          status_manutencao NOT NULL DEFAULT 'Pendente'
);

CREATE INDEX idx_manutencao_equipamento ON registros_manutencao(equipamento_id);
CREATE INDEX idx_manutencao_data ON registros_manutencao(data DESC);

-- ============================================================
-- TABELA: sessoes (tokens de autenticação OTP)
-- ============================================================
CREATE TABLE sessoes (
  token      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT NOT NULL REFERENCES usuarios(email),
  nivel      nivel_usuario NOT NULL,
  filial     TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessoes_email ON sessoes(email);
CREATE INDEX idx_sessoes_expira_em ON sessoes(expira_em);

-- ============================================================
-- TABELA: otp_codes (códigos temporários de login)
-- ============================================================
CREATE TABLE otp_codes (
  email      TEXT PRIMARY KEY REFERENCES usuarios(email),
  code       TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_otp_expira_em ON otp_codes(expira_em);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE listas ENABLE ROW LEVEL SECURITY;
ALTER TABLE filiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE historico_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE emprestimos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE registros_manutencao ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FUNÇÕES AUXILIARES PARA RLS (leem claims do JWT)
-- ============================================================
CREATE OR REPLACE FUNCTION current_user_email()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'email';
$$;

CREATE OR REPLACE FUNCTION current_user_nivel()
RETURNS nivel_usuario LANGUAGE sql STABLE AS $$
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'nivel')::nivel_usuario;
$$;

CREATE OR REPLACE FUNCTION current_user_filial()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'filial';
$$;

CREATE OR REPLACE FUNCTION current_user_filiais_array()
RETURNS TEXT[] LANGUAGE sql STABLE AS $$
  SELECT string_to_array(current_setting('request.jwt.claims', true)::jsonb ->> 'filial', ',')::TEXT[];
$$;

-- ============================================================
-- POLÍTICAS RLS - USUARIOS
-- ============================================================
-- Usuário vê apenas a si mesmo
CREATE POLICY "usuarios_select_own" ON usuarios
  FOR SELECT USING (email = current_user_email());

-- Matriz/AdminFilial veem todos (para gestão)
CREATE POLICY "usuarios_select_admin" ON usuarios
  FOR SELECT USING (current_user_nivel() IN ('Matriz', 'AdminFilial'));

-- Matriz gerencia tudo
CREATE POLICY "usuarios_all_matriz" ON usuarios
  FOR ALL USING (current_user_nivel() = 'Matriz');

-- AdminFilial gerencia usuários da sua filial
CREATE POLICY "usuarios_all_admin_filial" ON usuarios
  FOR ALL USING (
    current_user_nivel() = 'AdminFilial' AND
    filial = current_user_filial()
  );

-- ============================================================
-- POLÍTICAS RLS - EQUIPAMENTOS
-- ============================================================
-- Matriz: acesso total
CREATE POLICY "equipamentos_all_matriz" ON equipamentos
  FOR ALL USING (current_user_nivel() = 'Matriz');

-- AdminFilial: apenas sua unidade
CREATE POLICY "equipamentos_all_admin_filial" ON equipamentos
  FOR ALL USING (
    current_user_nivel() = 'AdminFilial' AND
    unidade = current_user_filial()
  );

-- Filial: apenas sua unidade
CREATE POLICY "equipamentos_all_filial" ON equipamentos
  FOR ALL USING (
    current_user_nivel() = 'Filial' AND
    unidade = current_user_filial()
  );

-- Técnico: apenas unidades que atende
CREATE POLICY "equipamentos_all_tecnico" ON equipamentos
  FOR ALL USING (
    current_user_nivel() = 'Tecnico' AND
    unidade = ANY(current_user_filiais_array())
  );

-- ============================================================
-- POLÍTICAS RLS - LISTAS E FILIAIS (leitura para autenticados)
-- ============================================================
CREATE POLICY "listas_select_auth" ON listas
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "filiais_select_auth" ON filiais
  FOR SELECT USING (auth.role() = 'authenticated' AND ativo = TRUE);

-- ============================================================
-- POLÍTICAS RLS - HISTORICO (baseado no equipamento)
-- ============================================================
CREATE POLICY "historico_select" ON historico_itens
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM equipamentos e
      WHERE e.id = historico_itens.equipamento_id
      AND (
        current_user_nivel() = 'Matriz' OR
        (current_user_nivel() = 'AdminFilial' AND e.unidade = current_user_filial()) OR
        (current_user_nivel() = 'Filial' AND e.unidade = current_user_filial()) OR
        (current_user_nivel() = 'Tecnico' AND e.unidade = ANY(current_user_filiais_array()))
      )
    )
  );

-- ============================================================
-- POLÍTICAS RLS - EMPRESTIMOS (baseado no equipamento)
-- ============================================================
CREATE POLICY "emprestimos_all" ON emprestimos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM equipamentos e
      WHERE e.id = emprestimos.equipamento_id
      AND (
        current_user_nivel() = 'Matriz' OR
        (current_user_nivel() = 'AdminFilial' AND e.unidade = current_user_filial()) OR
        (current_user_nivel() = 'Filial' AND e.unidade = current_user_filial()) OR
        (current_user_nivel() = 'Tecnico' AND e.unidade = ANY(current_user_filiais_array()))
      )
    )
  );

-- ============================================================
-- POLÍTICAS RLS - MANUTENCAO (baseado no equipamento)
-- ============================================================
CREATE POLICY "manutencao_all" ON registros_manutencao
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM equipamentos e
      WHERE e.id = registros_manutencao.equipamento_id
      AND (
        current_user_nivel() = 'Matriz' OR
        (current_user_nivel() = 'AdminFilial' AND e.unidade = current_user_filial()) OR
        (current_user_nivel() = 'Filial' AND e.unidade = current_user_filial()) OR
        (current_user_nivel() = 'Tecnico' AND e.unidade = ANY(current_user_filiais_array()))
      )
    )
  );

-- ============================================================
-- POLÍTICAS RLS - AUDITORIA (apenas Matriz/AdminFilial)
-- ============================================================
CREATE POLICY "auditoria_select" ON auditoria
  FOR SELECT USING (current_user_nivel() IN ('Matriz', 'AdminFilial'));

-- ============================================================
-- POLÍTICAS RLS - SESSOES E OTP (apenas service_role / backend)
-- ============================================================
CREATE POLICY "sessoes_service_only" ON sessoes
  FOR ALL USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

CREATE POLICY "otp_service_only" ON otp_codes
  FOR ALL USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

-- ============================================================
-- TRIGGERS PARA updated_at AUTOMÁTICO
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = NOW();
  NEW.data_ultima_atualizacao = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_equipamentos_updated_at
  BEFORE UPDATE ON equipamentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- DADOS INICIAIS (SEED) - FILIAIS EXEMPLO
-- ============================================================
INSERT INTO filiais (nome) VALUES
  ('E.E. ADHEMAR ANTONIO PRADO'),
  ('E.E. ALCIDES BOSCOLO'),
  ('E.E. ANDRÉ NUNES JUNIOR'),
  ('E.E. ANTONIETA DE SOUZA ALCÂNTARA / CHARLOTTE MARIA SHAW MASON'),
  ('E.E. AQUILINO RIBEIRO / MARIA TEREZA SIMÕES DE ALMEIDA PROFESSORA'),
  ('E.E. ANÍSIO TEIXEIRA')
ON CONFLICT (nome) DO NOTHING;

-- ============================================================
-- VERIFICAÇÃO FINAL
-- ============================================================
-- Listar tabelas criadas
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Verificar RLS habilitado
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- Verificar policies
SELECT schemaname, tablename, policyname, cmd 
FROM pg_policies 
WHERE schemaname = 'public' 
ORDER BY tablename, policyname;