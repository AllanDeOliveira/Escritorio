# Central JVO ⚖️

Sistema interno do escritório para **controle de prazos e intimações**. Reúne num só lugar o que antes estava espalhado entre planilhas, o PJe e a caixa de intimações.

> [!IMPORTANT]
> **Uso interno. Repositório privado.** O sistema lida com dados de processos e clientes — veja [Dados sensíveis](#-dados-sensíveis) antes de mexer.

---

## 📦 Módulos

**Controle de prazos** — kanban com arrastar e soltar, prazo fatal separado do interno, auditoria de quem moveu e quando. Importa planilha `.xlsx`/`.csv` em dois formatos: o modelo padrão baixável pelo sistema e o formato "Publicações Processuais" do escritório, detectado automaticamente.

**Caixa de intimações (DJEN)** — sincroniza as comunicações por OAB, agrupa cópias do mesmo ato, e cada intimação vira prazo ou é descartada, com possibilidade de restaurar.

**Admin** — painel de controle.

---

## 🏗️ Arquitetura

Dois processos:

| Processo | Comando | Porta | Papel |
|---|---|---|---|
| **API** | `npm run dev` (em `backend/`) | 3001 | Express, rotas `/api/*`, crons DJEN e PJe |
| **Frontend** | `npm run dev` (em `frontend/`) | 5173 | Vite |



---

## 🛠️ Stack

**Backend** — Node 20+, Express 5, Prisma 5 + PostgreSQL, `@google/genai`, `xlsx`, `node-cron`, `pino`. Testes em Vitest.

**Frontend** — React 18 + Vite 6 + TypeScript, Firebase Auth (Google). Sem router: navegação por aba, com estado persistido em localStorage.

**Banco** — PostgreSQL via Prisma, 7 models com nomes de tabela em português.

**Infra local** — Docker Compose (PostgreSQL + pgAdmin).

---

## 🔌 Integrações

| Serviço | O que faz |
|---|---|
| **DataJud / CNJ** | API pública Elasticsearch. Última movimentação dos processos ativos para o aviso diário no WhatsApp |
| **DJEN / Comunica PJe** | Intimações por OAB, sem autenticação. As OABs monitoradas ficam em `backend/config/djen.json` |
| **Google Gemini** | Flash Lite para mensagens de WhatsApp |
| **MNI / PJe (TJMT)** | SOAP com certificado A1 (mTLS). Consulta avisos pendentes |
| **Firebase Auth** | Login com Google no frontend |

> [!CAUTION]
> **O MNI implementa apenas a consulta de avisos pendentes, de propósito.**
> `consultarTeorComunicacao`, `confirmarRecebimento` e `entregarManifestacaoProcessual` foram omitidos porque efetivam ciência — o que **dispara prazo** — ou peticionam em nome do advogado. Isso é uma trava de segurança deliberada, não uma pendência. Ampliar exige decisão do escritório, não só código.

O DJEN devolve HTTP 500 "sistema ocupado" com frequência; o cliente já trata com retry e backoff, paginação até 30 páginas e janela incremental com 2 dias de sobreposição.

---

## 🔧 Rodando localmente

**Pré-requisitos:** Node 20+, Docker Desktop, chaves do Gemini e do DataJud.

```bash
docker-compose up -d      # postgres :5433, pgadmin :5050

cd backend
npm install
npm run db:generate
npm run db:push

cd ../frontend
npm install
```

Variáveis de ambiente — `backend/.env`:

```env
DATABASE_URL=
PORT=
GEMINI_API_KEY=
DATAJUD_API_KEY=
MNI_URL=                     # opcional, default TJMT 1º grau
MNI_CPF=
MNI_SENHA=
MNI_CERT_PATH=
MNI_CERT_SENHA=
LOG_LEVEL=
```

E `frontend/.env`:

```env
VITE_API_URL=
VITE_LEGACY_API_URL=
```

> ⚠️ O Postgres do `docker-compose.yml` publica na porta **5433**, não 5432. A `DATABASE_URL` precisa refletir isso.

Para subir os dois processos de uma vez, use o `Iniciar_App.bat` na raiz. Ou manualmente, em dois terminais:

```bash
cd backend  && npm run dev          # :3001
cd frontend && npm run dev          # :5173
```

Testes: `npm test` nos dois projetos.

---

## 🔐 Dados sensíveis

Este repositório **não versiona** — e não deve voltar a versionar:

```
backend/.env                  chaves de API e string do banco
backend/config/escritorio.json
backend/prisma/*.db
```

O `.gitignore` já cobre tudo isso. Antes de adicionar exceção com `!`, considere que uma regra de negação cancela as regras anteriores — foi assim que peças de clientes acabaram versionadas por engano no passado.

---

## 🚧 Limitações conhecidas

- A autenticação valida o ID token do Firebase no backend (`src/infra/auth.js`) e só aceita contas `@jvo.adv.br` com e-mail verificado. O papel de admin continua vindo da tabela de usuários.
- A config do Firebase está fixa no código do frontend, não parametrizada por ambiente.

---

## 📁 Estrutura

```
backend/
  index.js                  API Express: config, admin, registro de rotas e crons
  config/
    djen.json               OABs monitoradas
  prisma/schema.prisma      7 models
  src/
    infra/                  prisma singleton, Gemini, logger
    middleware/             requireUser, requireAdmin
    routes/                 prazos, intimacoes, mni, user
    services/               djen, mni, pje, tribunal
frontend/src/
  App.tsx                   shell e navegação por abas
  DashboardTab / PrazosTab / AdminPanel
docker-compose.yml          postgres, pgadmin
render.yaml                 deploy do backend
Iniciar_App.bat             sobe backend e frontend numa janela
```

---

## 🧭 Grafo de código (graphify)

Este projeto mantém um grafo de conhecimento do código em `graphify-out/`. Antes de explorar por grep manual, veja as regras em [CLAUDE.md](CLAUDE.md).

---

## 📄 Licença

Software proprietário de uso interno — Copyright © 2026 JVO Advocacia. Todos os direitos reservados. Veja [LICENSE](LICENSE).
