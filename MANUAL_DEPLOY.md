# 📋 Manual Completo de Configuração e Deploy — SCE (Supabase + Node.js)

> **Versão:** 1.0  
> **Data:** Setembro 2026  
> **Sistema:** SCE — Sistema de Controle de Equipamentos  
> **Stack:** Front-end (HTML/JS) → API Node.js (Express) → Supabase (PostgreSQL)

---

## 🎯 Visão Geral da Arquitetura

```
┌─────────────────┐     HTTPS      ┌──────────────────┐     TCP/SSL      ┌──────────────┐
│   Navegador     │ ─────────────► │   API Node.js    │ ──────────────► │   Supabase   │
│  (Front-end)    │  fetch/REST    │  (Express)       │  @supabase/    │  (PostgreSQL)│
└─────────────────┘                └──────────────────┘   supabase-js    └──────────────┘
       ▲                                    │
       │         Arquivos estáticos         │
       └────────────────────────────────────┘
              (HTML, CSS, JS, api.js)
```

---

## 1️⃣ CONFIGURAÇÃO DO SUPABASE

### 1.1 Criar Projeto Gratuito

1. Acesse https://supabase.com e faça login (GitHub/Google/Email)
2. Clique em **"New Project"**
3. Preencha:
   - **Name:** `sce-sistema` (ou nome de sua preferência)
   - **Database Password:** Gere uma senha forte (salve em local seguro!)
   - **Region:** `South America (São Paulo)` — menor latência
   - **Pricing Plan:** `Free` (até 500 MB database, 1 GB file storage)
4. Clique em **"Create new project"** — aguarde ~2 minutos

### 1.2 Obter Credenciais

No dashboard do projeto, vá em **Settings → API**:

| Variável | Onde encontrar | Exemplo |
|----------|----------------|---------|
| `SUPABASE_URL` | Project URL | `https://abcdefghijklmnop.supabase.co` |
| `SUPABASE_ANON_KEY` | `anon` public key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` secret key (⚠️ **não exponha no front-end**) | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |

> **Importante:** A `service_role_key` tem poderes de admin (bypass RLS). Use **apenas no backend**.

### 1.3 Criar Tabelas (SQL)

Execute no **SQL Editor** do Supabase (botão "New Query"):

```sql
-- ============================================================
-- SCE - SISTEMA DE CONTROLE DE EQUIPAMENTOS
-- Schema completo baseado no mapeamento das abas do Google Sheets
-- ============================================================

-- Habilitar extensão UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS (para validação no banco)
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
  email         TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  nivel         nivel_usuario NOT NULL DEFAULT 'Filial',
  filial        TEXT NOT NULL,
  status        status_usuario NOT NULL DEFAULT 'Ativo',
  data_remocao  TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  escola_destino              TEXT,
  UNIQUE (patrimonio) WHERE patrimonio IS NOT NULL,
  UNIQUE (numero_serie) WHERE numero_serie IS NOT NULL
);

CREATE INDEX idx_equipamentos_unidade ON equipamentos(unidade);
CREATE INDEX idx_equipamentos_status ON equipamentos(status);
CREATE INDEX idx_equipamentos_categoria ON equipamentos(categoria);
CREATE INDEX idx_equipamentos_patrimonio ON equipamentos(patrimonio) WHERE patrimonio IS NOT NULL;
CREATE INDEX idx_equipamentos_numero_serie ON equipamentos(numero_serie) WHERE numero_serie IS NOT NULL;
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
-- POLÍTICAS RLS - USUARIOS
-- ============================================================
-- Usuários podem ver apenas a si mesmos (para login/perfil)
CREATE POLICY "usuarios_select_own" ON usuarios
  FOR SELECT USING (email = current_user_email());

-- Admins (Matriz/AdminFilial) podem ver todos
CREATE POLICY "usuarios_select_admin" ON usuarios
  FOR SELECT USING (
    current_user_nivel() IN ('Matriz', 'AdminFilial')
  );

-- Matriz pode inserir/atualizar/remover qualquer usuário
CREATE POLICY "usuarios_all_matriz" ON usuarios
  FOR ALL USING (current_user_nivel() = 'Matriz');

-- AdminFilial pode gerenciar usuários da sua filial
CREATE POLICY "usuarios_all_admin_filial" ON usuarios
  FOR ALL USING (
    current_user_nivel() = 'AdminFilial' AND
    filial = current_user_filial()
  );

-- ============================================================
-- POLÍTICAS RLS - EQUIPAMENTOS
-- ============================================================
-- Matriz vê tudo
CREATE POLICY "equipamentos_all_matriz" ON equipamentos
  FOR ALL USING (current_user_nivel() = 'Matriz');

-- AdminFilial vê apenas da sua unidade
CREATE POLICY "equipamentos_all_admin_filial" ON equipamentos
  FOR ALL USING (
    current_user_nivel() = 'AdminFilial' AND
    unidade = current_user_filial()
  );

-- Filial vê apenas da sua unidade
CREATE POLICY "equipamentos_all_filial" ON equipamentos
  FOR ALL USING (
    current_user_nivel() = 'Filial' AND
    unidade = current_user_filial()
  );

-- Técnico vê apenas das unidades que atende
CREATE POLICY "equipamentos_all_tecnico" ON equipamentos
  FOR ALL USING (
    current_user_nivel() = 'Tecnico' AND
    unidade = ANY(current_user_filiais_array())
  );

-- ============================================================
-- POLÍTICAS RLS - LISTAS E FILIAIS (leitura pública autenticada)
-- ============================================================
CREATE POLICY "listas_select_auth" ON listas
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "filiais_select_auth" ON filiais
  FOR SELECT USING (auth.role() = 'authenticated' AND ativo = TRUE);

-- ============================================================
-- POLÍTICAS RLS - HISTORICO, EMPRESTIMOS, MANUTENCAO, AUDITORIA
-- ============================================================
-- Mesma lógica de equipamentos (acesso baseado na unidade do equipamento)
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

CREATE POLICY "auditoria_select" ON auditoria
  FOR SELECT USING (current_user_nivel() IN ('Matriz', 'AdminFilial'));

-- ============================================================
-- POLÍTICAS RLS - SESSOES E OTP (apenas service_role/backend)
-- ============================================================
-- Front-end NÃO acessa diretamente; backend usa service_role_key
CREATE POLICY "sessoes_service_only" ON sessoes
  FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

CREATE POLICY "otp_service_only" ON otp_codes
  FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

-- ============================================================
-- FUNÇÕES AUXILIARES PARA RLS
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
```

### 1.4 Configurar RLS (Row Level Security)

O SQL acima já inclui as políticas. **Resumo do que elas fazem:**

| Tabela | Quem acessa | Condição |
|--------|-------------|----------|
| `usuarios` | Próprio usuário | `email = current_user_email()` |
| `usuarios` | Matriz | `nivel = 'Matriz'` |
| `usuarios` | AdminFilial | `nivel = 'AdminFilial' AND filial = current_user_filial()` |
| `equipamentos` | Matriz | Tudo |
| `equipamentos` | AdminFilial/Filial | `unidade = current_user_filial()` |
| `equipamentos` | Técnico | `unidade = ANY(current_user_filiais_array())` |
| `listas`, `filiais` | Qualquer autenticado | `auth.role() = 'authenticated'` |
| `historico`, `emprestimos`, `manutencao` | Baseado no equipamento | Mesma regra de `equipamentos` |
| `sessoes`, `otp_codes` | Apenas backend (service_role) | `role = 'service_role'` |

> **Como funciona:** O backend Node.js usa a `SUPABASE_SERVICE_ROLE_KEY` (que tem role `service_role`) e faz as queries em nome do usuário, passando os claims via `supabase.auth.getUser()` ou headers. As funções `current_user_*()` leem do JWT.

---

## 2️⃣ CONFIGURAÇÃO DO BACKEND LOCAL

### 2.1 Pré-requisitos

- Node.js **18+** (recomendado 20 LTS)
- Git
- Conta no Supabase (projeto criado na etapa 1)

### 2.2 Instalar Dependências

```bash
# Na pasta do projeto (onde está package.json)
cd C:\Users\Pablo\Desktop\sce

# Instala dependências
npm install

# Verifica se instalou corretamente
npm list --depth=0
```

### 2.3 Configurar `.env`

Copie o exemplo e edite:

```bash
# Windows PowerShell
Copy-Item .env.example .env

# Linux/Mac
cp .env.example .env
```

Edite o arquivo `.env` com **suas credenciais reais**:

```env
# ============================================================
# SUPABASE (obrigatório)
# ============================================================
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ============================================================
# APP
# ============================================================
PORT=3001
NODE_ENV=development
APP_URL=http://localhost:3001

# ============================================================
# GOOGLE SHEETS (apenas para migração de dados - opcional)
# ============================================================
GOOGLE_SERVICE_ACCOUNT_EMAIL=seu-service-account@projeto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nSUA_CHAVE_PRIVADA_AQUI\n-----END PRIVATE KEY-----\n"
GOOGLE_PROJECT_ID=seu-projeto-id

SPREADSHEET_CORE_ID=12_mPXKeEZJMpj2ZEpzI3HOYwqShJWDjD7787elXVxXk
SPREADSHEET_MOVIMENTACAO_ID=1BhGd2zUMkD1u1NfgzPO3xJx8s_8oLt22X3VX9jvwA6A
SPREADSHEET_AUTENTICACAO_ID=1Put-0wIVN-60oP5EaunbSCwbDhzCo2yLxJ_FV26auy0
```

> ⚠️ **NUNCA commite o `.env` no Git!** Ele já está no `.gitignore`.

### 2.4 Rodar Localmente

```bash
# Desenvolvimento (com auto-reload)
npm run dev

# Produção local
npm start
```

**Saída esperada:**
```
🚀 Servidor rodando na porta 3001
📊 Ambiente: development
```

Teste no navegador: http://localhost:3001/health
```json
{"success":true,"data":{"status":"ok","timestamp":"2026-09-04T..."}}
```

---

## 3️⃣ DEPLOY NO RENDER (RECOMENDADO)

### 3.1 Preparar Repositório Git

```bash
# Se ainda não tem repositório
git init
git add .
git commit -m "Initial commit: SCE backend + frontend"

# Suba para GitHub/GitLab/Bitbucket
# Crie um repo vazio no GitHub e:
git remote add origin https://github.com/SEU_USUARIO/sce.git
git branch -M main
git push -u origin main
```

### 3.2 Criar Web Service no Render

1. Acesse https://dashboard.render.com → **New +** → **Web Service**
2. Conecte seu repositório GitHub
3. Configure:

| Campo | Valor |
|-------|-------|
| **Name** | `sce-api` |
| **Region** | `South America (São Paulo)` |
| **Branch** | `main` |
| **Root Directory** | (deixe vazio se `package.json` está na raiz) |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` (para testar) ou `Starter` ($7/mês - sem cold start) |

4. **Environment Variables** (clique em "Add Environment Variable"):

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | `https://SEU_PROJETO.supabase.co` |
| `SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `NODE_ENV` | `production` |
| `PORT` | `10000` (Render ignora, mas mantenha) |
| `APP_URL` | `https://sce-api.onrender.com` (será a URL gerada) |

5. Clique em **"Create Web Service"** — aguarde o build (~3-5 min)

### 3.3 Evitar Cold Start (Plano Free)

No plano **Free**, o serviço "dorme" após 15 min sem requisições.

**Opções:**
- **Upgrade para Starter ($7/mês):** Sempre ativo, 512 MB RAM, 0.5 CPU
- **Cron job externo (grátis):** Use https://cron-job.org ou GitHub Actions para fazer `GET /health` a cada 10 min

**Exemplo GitHub Actions (`.github/workflows/keep-alive.yml`):**
```yaml
name: Keep Alive
on:
  schedule:
    - cron: '*/10 * * * *'  # a cada 10 minutos
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping API
        run: curl -f https://sce-api.onrender.com/health || exit 1
```

### 3.4 Deploy do Front-end (Opcional)

O front-end são arquivos estáticos. Opções:

| Plataforma | Como fazer |
|------------|------------|
| **Render Static Site** | New → Static Site → Build: `echo 'static'` → Publish: `.` |
| **Vercel** | `vercel --prod` na pasta do projeto |
| **Netlify** | Arraste a pasta no painel |
| **GitHub Pages** | Settings → Pages → Deploy from branch |

> **Importante:** No front-end de produção, configure a `API_BASE_URL`:
> ```html
> <meta name="api-base-url" content="https://sce-api.onrender.com/api">
> ```

---

## 4️⃣ MIGRAÇÃO DE DADOS (GOOGLE SHEETS → SUPABASE)

### 4.1 Script de Migração

Crie `migrate.js` na raiz do projeto:

```javascript
// migrate.js - Execute UMA VEZ: node migrate.js
// Requer: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_PROJECT_ID no .env

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Config Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    project_id: process.env.GOOGLE_PROJECT_ID,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

const SPREADSHEETS = {
  CORE: process.env.SPREADSHEET_CORE_ID,
  MOVIMENTACAO: process.env.SPREADSHEET_MOVIMENTACAO_ID,
  AUTENTICACAO: process.env.SPREADSHEET_AUTENTICACAO_ID,
};

async function getSheetValues(spreadsheetKey, range) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEETS[spreadsheetKey],
    range,
  });
  return response.data.values || [];
}

async function migrate() {
  console.log('🚀 Iniciando migração Google Sheets → Supabase...\n');

  try {
    // ---------- 1. USUARIOS ----------
    console.log('📥 Migrando usuários...');
    const usuariosData = await getSheetValues('AUTENTICACAO', 'Usuarios');
    if (usuariosData.length > 1) {
      const headers = usuariosData[0];
      const rows = usuariosData.slice(1);
      for (const row of rows) {
        const [email, nome, nivel, filial, status, dataRemocao] = row;
        if (!email) continue;
        const { error } = await supabase.from('usuarios').upsert({
          email: email.trim().toLowerCase(),
          nome: nome?.trim() || '',
          nivel: nivel?.trim() || 'Filial',
          filial: filial?.trim() || '',
          status: status?.trim() || 'Ativo',
          data_remocao: dataRemocao ? new Date(dataRemocao).toISOString() : null,
        }, { onConflict: 'email' });
        if (error) console.error(`  ⚠️ ${email}:`, error.message);
      }
      console.log(`  ✅ ${rows.length} usuários processados`);
    }

    // ---------- 2. FILIAIS ----------
    console.log('📥 Migrando filiais...');
    const filiaisData = await getSheetValues('CORE', 'Filiais');
    if (filiaisData.length > 1) {
      const rows = filiaisData.slice(1);
      for (const row of rows) {
        const nome = row[0]?.trim();
        if (!nome) continue;
        const { error } = await supabase.from('filiais').upsert({ nome }, { onConflict: 'nome' });
        if (error) console.error(`  ⚠️ ${nome}:`, error.message);
      }
      console.log(`  ✅ ${rows.length} filiais processadas`);
    }

    // ---------- 3. LISTAS (categoria, marca, modelo) ----------
    console.log('📥 Migrando listas (categoria/marca/modelo)...');
    const listasData = await getSheetValues('CORE', 'Listas');
    if (listasData.length > 1) {
      const headers = listasData[0];
      const idxCat = headers.indexOf('categoria') >= 0 ? headers.indexOf('categoria') : 0;
      const idxMarca = headers.indexOf('marca') >= 0 ? headers.indexOf('marca') : 1;
      const idxModelo = headers.indexOf('modelo') >= 0 ? headers.indexOf('modelo') : 2;
      const rows = listasData.slice(1);
      let count = 0;
      for (const row of rows) {
        const categoria = row[idxCat]?.trim();
        const marca = row[idxMarca]?.trim();
        const modelo = row[idxModelo]?.trim();
        if (!categoria || !marca || !modelo) continue;
        const { error } = await supabase.from('listas').upsert({
          categoria, marca, modelo
        }, { onConflict: 'categoria,marca,modelo' });
        if (error) console.error(`  ⚠️ ${categoria}/${marca}/${modelo}:`, error.message);
        count++;
      }
      console.log(`  ✅ ${count} combinações processadas`);
    }

    // ---------- 4. EQUIPAMENTOS ----------
    console.log('📥 Migrando equipamentos (pode demorar)...');
    const equipData = await getSheetValues('CORE', 'Equipamentos');
    if (equipData.length > 1) {
      const headers = equipData[0];
      const rows = equipData.slice(1);
      let success = 0, errors = 0;
      for (const row of rows) {
        const obj = {};
        headers.forEach((h, i) => obj[h] = row[i] || '');
        if (!obj.id) obj.id = crypto.randomUUID(); // gera UUID se não tiver
        
        // Mapear campos (snake_case para o banco)
        const equip = {
          id: obj.id,
          unidade: obj.unidade,
          categoria: obj.categoria,
          marca: obj.marca,
          modelo: obj.modelo,
          patrimonio: obj.patrimonio || null,
          numero_serie: obj.numeroSerie || null,
          status: obj.status || 'Disponível',
          status_manutencao: obj.statusManutencao || null,
          vinculado_blue_monitor: obj.vinculadoBlueMonitor || 'Não',
          numero_chamado_manutencao: obj.numeroChamadoManutencao || null,
          boletim_ocorrencia: obj.boletimOcorrencia || null,
          justificativa_verificacao: obj.justificativaVerificacao || null,
          descricao_quebrado: obj.descricaoQuebrado || null,
          sistema_operacional: obj.sistemaOperacional || null,
          processador: obj.processador || null,
          memoria_ram: obj.memoriaRAM || null,
          armazenamento: obj.armazenamento || null,
          tamanho_tela: obj.tamanhoTela || null,
          responsavel_atual: obj.responsavelAtual || null,
          observacoes: obj.observacoes || null,
          data_cadastro: obj.dataCadastro ? new Date(obj.dataCadastro).toISOString() : new Date().toISOString(),
          data_ultima_atualizacao: obj.dataUltimaAtualizacao ? new Date(obj.dataUltimaAtualizacao).toISOString() : new Date().toISOString(),
          cadastrado_por: obj.cadastradoPor || 'migracao',
          ultima_alteracao_por: obj.ultimaAlteracaoPor || 'migracao',
          justificativa_patrimonio: obj.justificativaPatrimonio || null,
          justificativa_numero_serie: obj.justificativaNumeroSerie || null,
          boletim_ocorrencia_anexo_url: obj.boletimOcorrenciaAnexoUrl || null,
          tipo_emprestimo: obj.tipoEmprestimo || null,
          escola_destino: obj.escolaDestino || null,
        };

        const { error } = await supabase.from('equipamentos').upsert(equip, { onConflict: 'id' });
        if (error) { console.error(`  ⚠️ ${obj.id}:`, error.message); errors++; }
        else success++;
      }
      console.log(`  ✅ ${success} equipamentos migrados, ${errors} erros`);
    }

    // ---------- 5. HISTORICO ----------
    console.log('📥 Migrando histórico...');
    const histData = await getSheetValues('MOVIMENTACAO', 'Historico_Itens');
    if (histData.length > 1) {
      const headers = histData[0];
      const rows = histData.slice(1);
      for (const row of rows) {
        const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
        const { error } = await supabase.from('historico_itens').upsert({
          id: obj.id || crypto.randomUUID(),
          equipamento_id: obj.equipamentoId,
          campo: obj.campo,
          valor_antigo: obj.valorAntigo,
          valor_novo: obj.valorNovo,
          autor: obj.autor,
          data: obj.data ? new Date(obj.data).toISOString() : new Date().toISOString(),
        }, { onConflict: 'id' });
        if (error) console.error(`  ⚠️ Histórico:`, error.message);
      }
      console.log(`  ✅ ${rows.length} registros de histórico processados`);
    }

    // ---------- 6. EMPRESTIMOS ----------
    console.log('📥 Migrando empréstimos...');
    const empData = await getSheetValues('MOVIMENTACAO', 'Emprestimos');
    if (empData.length > 1) {
      const headers = empData[0];
      const rows = empData.slice(1);
      for (const row of rows) {
        const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
        const { error } = await supabase.from('emprestimos').upsert({
          id: obj.id || crypto.randomUUID(),
          equipamento_id: obj.equipamentoId,
          patrimonio: obj.patrimonio,
          unidade: obj.unidade,
          responsavel: obj.responsavel,
          cpf: obj.cpf,
          email_responsavel: obj.emailResponsavel,
          data_emprestimo: obj.dataEmprestimo ? new Date(obj.dataEmprestimo).toISOString() : new Date().toISOString(),
          data_prevista_devolucao: obj.dataPrevistaDevolucao ? new Date(obj.dataPrevistaDevolucao).toISOString().split('T')[0] : null,
          data_devolucao: obj.dataDevolucao ? new Date(obj.dataDevolucao).toISOString() : null,
          status: obj.status || 'Emprestado',
          termo_pdf_url: obj.termoPdfUrl,
          criado_por: obj.criadoPor,
          devolvido_por: obj.devolvidoPor,
          observacoes: obj.observacoes,
          tipo_emprestimo: obj.tipoEmprestimo || 'interno',
          escola_destino: obj.escolaDestino,
        }, { onConflict: 'id' });
        if (error) console.error(`  ⚠️ Empréstimo:`, error.message);
      }
      console.log(`  ✅ ${rows.length} empréstimos processados`);
    }

    // ---------- 7. REGISTROS_MANUTENCAO ----------
    console.log('📥 Migrando manutenções...');
    const manData = await getSheetValues('MOVIMENTACAO', 'Registros_Manutencao');
    if (manData.length > 1) {
      const headers = manData[0];
      const rows = manData.slice(1);
      for (const row of rows) {
        const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
        const { error } = await supabase.from('registros_manutencao').upsert({
          id: obj.id || crypto.randomUUID(),
          equipamento_id: obj.equipamentoId,
          autor: obj.autor,
          data: obj.data ? new Date(obj.data).toISOString() : new Date().toISOString(),
          descricao: obj.descricao,
          status: obj.status || 'Pendente',
        }, { onConflict: 'id' });
        if (error) console.error(`  ⚠️ Manutenção:`, error.message);
      }
      console.log(`  ✅ ${rows.length} manutenções processadas`);
    }

    // ---------- 8. AUDITORIA ----------
    console.log('📥 Migrando auditoria...');
    const audData = await getSheetValues('MOVIMENTACAO', 'Auditoria');
    if (audData.length > 1) {
      const headers = audData[0];
      const rows = audData.slice(1);
      for (const row of rows) {
        const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
        const { error } = await supabase.from('auditoria').insert({
          data: obj.data ? new Date(obj.data).toISOString() : new Date().toISOString(),
          usuario: obj.usuario,
          acao: obj.acao,
          detalhes: obj.detalhes,
        });
        if (error) console.error(`  ⚠️ Auditoria:`, error.message);
      }
      console.log(`  ✅ ${rows.length} auditorias processadas`);
    }

    console.log('\n🎉 Migração concluída com sucesso!');
    console.log('🔍 Verifique no Supabase Dashboard → Table Editor');

  } catch (err) {
    console.error('\n❌ Erro fatal na migração:', err);
    process.exit(1);
  }
}

migrate();
```

### 4.2 Executar Migração

```bash
# 1. Instale dependência extra para Supabase
npm install @supabase/supabase-js

# 2. Certifique-se que .env tem TODAS as variáveis (incluindo Google Sheets)

# 3. Execute
node migrate.js
```

**Saída esperada:**
```
🚀 Iniciando migração Google Sheets → Supabase...

📥 Migrando usuários...
  ✅ 15 usuários processados
📥 Migrando filiais...
  ✅ 150 filiais processadas
📥 Migrando listas...
  ✅ 320 combinações processadas
📥 Migrando equipamentos...
  ✅ 1250 equipamentos migrados, 0 erros
📥 Migrando histórico...
  ✅ 3400 registros processados
📥 Migrando empréstimos...
  ✅ 85 empréstimos processados
📥 Migrando manutenções...
  ✅ 210 manutenções processadas
📥 Migrando auditoria...
  ✅ 560 auditorias processadas

🎉 Migração concluída com sucesso!
```

---

## 5️⃣ TESTES PÓS-DEPLOY

### 5.1 Testar API (Health Check)

```bash
# Local
curl http://localhost:3001/health

# Produção (Render)
curl https://sce-api.onrender.com/health
```

**Resposta esperada:**
```json
{"success":true,"data":{"status":"ok","timestamp":"2026-09-04T..."}}
```

### 5.2 Testar Rotas Principais (Postman/Insomnia/Thunder Client)

Importe esta collection no Postman:

```json
{
  "info": {"name": "SCE API", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
  "variable": [{"key": "baseUrl", "value": "https://sce-api.onrender.com/api", "type": "string"}],
  "item": [
    {"name": "Health", "request": {"method": "GET", "url": "{{baseUrl}}/../health"}},
    {"name": "Request OTP", "request": {"method": "POST", "url": "{{baseUrl}}/request-otp", "body": {"mode": "raw", "raw": "{\"email\":\"teste@exemplo.com\"}", "options": [{"key": "Content-Type", "value": "application/json"}]}}},
    {"name": "Validate OTP", "request": {"method": "POST", "url": "{{baseUrl}}/validate-otp", "body": {"mode": "raw", "raw": "{\"email\":\"teste@exemplo.com\",\"code\":\"123456\"}", "options": [{"key": "Content-Type", "value": "application/json"}]}}},
    {"name": "Listar Usuários (precisa token)", "request": {"method": "GET", "url": "{{baseUrl}}/listar-usuarios", "header": [{"key": "Authorization", "value": "Bearer {{token}}"}]}},
    {"name": "Equipamentos da Filial", "request": {"method": "GET", "url": "{{baseUrl}}/equipamentos-da-filial", "header": [{"key": "Authorization", "value": "Bearer {{token}}"}]}},
    {"name": "Criar Equipamento", "request": {"method": "POST", "url": "{{baseUrl}}/create-equipamento", "header": [{"key": "Authorization", "value": "Bearer {{token}}"}], "body": {"mode": "raw", "raw": "{\"unidade\":\"E.E. TESTE\",\"categoria\":\"Notebook\",\"marca\":\"Dell\",\"modelo\":\"Latitude 5420\",\"patrimonio\":\"12345\",\"numeroSerie\":\"ABC123\",\"status\":\"Disponível\"}", "options": [{"key": "Content-Type", "value": "application/json"}]}}}
  ]
}
```

### 5.3 Testar Front-end em Produção

1. **Deploy do front-end** (Vercel/Netlify/Render Static)
2. **Configure a meta tag** no `Shared.html` ou no `<head>` de cada página:
   ```html
   <meta name="api-base-url" content="https://sce-api.onrender.com/api">
   ```
3. **Acesse a URL do front-end** (ex: `https://sce-frontend.vercel.app`)
4. **Fluxo de teste:**
   - ✅ Página de login carrega
   - ✅ Digite e-mail → clique "Enviar código"
   - ✅ Recebe código (simulado no console/logs do Render)
   - ✅ Digita código → clica "Entrar"
   - ✅ Redireciona para dashboard correto (Matriz/Técnico/Filial)
   - ✅ Lista equipamentos carrega
   - ✅ Filtros funcionam
   - ✅ Cadastra novo equipamento → aparece na lista
   - ✅ Edita equipamento → alteração salva
   - ✅ Abre histórico → mostra alterações
   - ✅ Registra manutenção → aparece no log
   - ✅ Exporta CSV → baixa arquivo

### 5.4 Verificar Logs no Render

1. Dashboard Render → seu serviço → **Logs**
2. Procure por:
   - `🚀 Servidor rodando na porta 10000`
   - Requisições `GET /api/...` com status 200
   - Erros 500 (investigue se houver)

### 5.5 Checklist Final

| Item | Status |
|------|--------|
| Projeto Supabase criado | ☐ |
| Tabelas + RLS executadas | ☐ |
| `.env` configurado local | ☐ |
| `npm run dev` funciona local | ☐ |
| Migração de dados executada | ☐ |
| Repositório no GitHub | ☐ |
| Serviço Render criado | ☐ |
| Variáveis de ambiente no Render | ☐ |
| Deploy bem-sucedido (build verde) | ☐ |
| `/health` responde 200 em produção | ☐ |
| Front-end aponta para API de produção | ☐ |
| Login OTP funciona em produção | ☐ |
| CRUD equipamentos funciona | ☐ |
| Filtros, histórico, manutenção OK | ☐ |
| Exportar CSV/PDF funciona | ☐ |

---

## 🆘 SOLUÇÃO DE PROBLEMAS COMUNS

| Erro | Causa | Solução |
|------|-------|---------|
| `relation "equipamentos" does not exist` | Tabelas não criadas | Execute o SQL da seção 1.3 no SQL Editor |
| `JWT expired` / `invalid token` | Token OTP expirado | Solicite novo código; verifique `OTP_EXPIRATION_MS` |
| `permission denied for table usuarios` | RLS bloqueando | Use `service_role_key` no backend; verifique policies |
| `CORS error` no front-end | API não permite origem | `app.use(cors())` já está no server.js; verifique se front-end usa HTTPS |
| `Cold start` demora 30s | Plano Free Render | Upgrade para Starter ou configure cron job |
| `Cannot find module '@supabase/supabase-js'` | Dependência faltando | `npm install @supabase/supabase-js` |
| Migração para em erro de FK | Usuário não existe | Migre `usuarios` ANTES de `equipamentos`/`emprestimos` |
| `unique constraint` em patrimonio/serie | Dados duplicados na planilha | Limpe duplicatas na planilha antes de migrar |

---

## 📞 SUPORTE E PRÓXIMOS PASSOS

- **Documentação Supabase:** https://supabase.com/docs
- **Documentação Render:** https://render.com/docs
- **Node.js Best Practices:** https://github.com/goldbergyoni/nodebestpractices

**Próximas melhorias sugeridas:**
1. ✅ Autenticação JWT completa (access/refresh tokens)
2. 🔄 Webhooks para notificações em tempo real (Supabase Realtime)
3. 📊 Dashboard de métricas (Grafana/Prometheus)
4. 🧪 Testes automatizados (Jest + Supertest)
5. 🔒 Rate limiting (express-rate-limit)
6. 📝 Logs estruturados (Pino/Winston + Loki)

---

**Manual gerado automaticamente com base no código do projeto SCE.**  
Para dúvidas, consulte o código-fonte em `server.js`, `googleSheetsService.js` e `api.js`.