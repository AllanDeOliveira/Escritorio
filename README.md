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

**Backend** — Node 20+, Express 5, Prisma 5 + PostgreSQL, `xlsx`, `node-cron`, `pino`. Testes em Vitest.

**Frontend** — React 18 + Vite 6 + TypeScript, Firebase Auth (Google). Sem router: navegação por aba, com estado persistido em localStorage.

**Banco** — PostgreSQL via Prisma, 5 models com nomes de tabela em português.

**Infra local** — Docker Compose (PostgreSQL + pgAdmin).

---

## 🔌 Integrações

| Serviço | O que faz |
|---|---|
| **DJEN / Comunica PJe** | Intimações por OAB, sem autenticação. As OABs monitoradas ficam em `backend/config/djen.json`. Cron 06:30, dias úteis |
| **Painel do Advogado do PJe** | Robô com certificado A1 + TOTP lê os expedientes pendentes (TJMT e TRF1, 1º e 2º grau) e cria os prazos no quadro com a data limite que o próprio PJe calcula. **Somente leitura**: nunca toma ciência nem abre o ato. Cron 06:40 e 12:40, dias úteis |
| **Firebase Auth** | Login com Google no frontend; o backend valida o ID token e só aceita `@jvo.adv.br` |

> [!CAUTION]
> **O robô do PJe só lê, de propósito.**
> Tomar ciência **dispara prazo**, e peticionar age em nome do advogado; por isso nenhuma das duas coisas foi implementada. Isso é uma trava de segurança deliberada, não uma pendência. Ampliar exige decisão do escritório, não só código.

O DJEN devolve HTTP 500 "sistema ocupado" com frequência; o cliente já trata com retry e backoff, paginação até 30 páginas e janela incremental com 2 dias de sobreposição.

---

## 🔧 Rodando localmente

**Pré-requisitos:** Node 20+, Docker Desktop. Para o robô do PJe, o certificado A1 (.pfx) do advogado e o segredo TOTP do SSO.

```bash
cp .env.example .env      # preencha POSTGRES_* e PGADMIN_* (lidos pelo compose)
docker compose up -d      # postgres 127.0.0.1:5433, pgadmin 127.0.0.1:5050

cd backend
npm install
npm run db:generate
npm run db:push

cd ../frontend
npm install
```

Variáveis de ambiente — `backend/.env`:

```env
DATABASE_URL=                # postgresql://usuario:senha@localhost:5433/banco
PORT=3001
LOG_LEVEL=                   # opcional; debug | info | warn | error
FRONTEND_URL=                # opcional; origem do CORS (padrão: localhost:5173)
FIREBASE_PROJECT_ID=         # opcional; padrão é o projeto do frontend
MNI_CERT_PATH=               # certificado A1 (.pfx) do robô do PJe
MNI_CERT_SENHA=
PJE_TOTP_SECRET=             # 2FA do SSO do PJe; sem ele o robô não roda
PJE_URL=                     # opcional; padrão TJMT 1º grau
DISABLE_DJEN_CRON=           # true desliga a busca automática
DISABLE_PJE_CRON=            # true desliga a busca automática
```

O `.env.example` da raiz lista todas com comentários. O frontend não precisa de `.env` quando o backend roda em `localhost:3001`; em outro endereço, defina `VITE_API_URL` em `frontend/.env`.

> ⚠️ O Postgres do `docker-compose.yml` publica na porta **5433** (só nesta máquina, `127.0.0.1`), não 5432. A `DATABASE_URL` precisa refletir isso.

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
.env                          senhas do Postgres/pgAdmin (compose)
backend/.env                  string do banco, senha do certificado, segredo TOTP
backend/config/escritorio.json
backend/prisma/*.db
backups/, *.dump, *.sql       cópias do banco — dados de clientes
backend/pje-*.txt             dumps de página do PJe
```

Cópia de segurança do banco (gera um `.dump` restaurável com `pg_restore`):

```bash
docker exec central_jvo_postgres pg_dump -U <usuario> -d <banco> -Fc > backups/central-jvo-$(date +%Y%m%d).dump
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
  prisma/schema.prisma      5 models
  src/
    infra/                  prisma singleton, auth (Firebase), logger
    middleware/             requireUser, requireAdmin
    routes/                 prazos, intimacoes, user
    services/               djen, pjePainel (robô), pjeSso (login A1 + TOTP)
frontend/src/
  App.tsx                   shell e navegação por abas
  DashboardTab / PrazosTab / AdminPanel
docker-compose.yml          postgres, pgadmin
Iniciar_App.bat             sobe backend e frontend numa janela (religa o backend se cair)
```

---

## 🧭 Grafo de código (graphify)

Este projeto mantém um grafo de conhecimento do código em `graphify-out/`. Antes de explorar por grep manual, veja as regras em [CLAUDE.md](CLAUDE.md).

---

## 📄 Licença

Software proprietário de uso interno — Copyright © 2026 JVO Advocacia. Todos os direitos reservados. Veja [LICENSE](LICENSE).
