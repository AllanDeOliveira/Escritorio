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
| **API** | `npm run dev` (em `backend/`) | 3001 | Express, rotas `/api/*`, cron do DJEN |
| **Frontend** | `npm run dev` (em `frontend/`) | 5180 | Vite |
| **Robô do PJe** | `npm run robo-pje -- rodar` (em `robo-pje/`) | — | No PC de quem tem o certificado; envia a leitura à API |



---

## 🛠️ Stack

**Backend** — Node 20+, Express 5, Prisma 5 + PostgreSQL, `xlsx`, `node-cron`, `pino`. Testes em Vitest.

**Frontend** — React 18 + Vite 6 + TypeScript. Sem router: navegação por aba, com estado persistido em localStorage. Em produção o próprio backend serve o build (`frontend/dist`) no mesmo endereço da API.

**Banco** — PostgreSQL via Prisma, 5 models com nomes de tabela em português.

**Infra local** — Docker Compose (PostgreSQL + pgAdmin).

---

## 🔌 Integrações

| Serviço | O que faz |
|---|---|
| **DJEN / Comunica PJe** | Intimações por OAB, sem autenticação. As OABs monitoradas ficam em `backend/config/djen.json`. Cron 06:30, dias úteis |
| **Painel do Advogado do PJe** | O robô (`robo-pje/`) roda **no PC de quem tem o certificado A1**, lê os expedientes pendentes (TJMT e TRF1, 1º e 2º grau) e envia só a lista ao servidor, que cria e baixa os prazos com a data limite que o próprio PJe calcula. **O servidor nunca guarda certificado, senha nem 2FA.** **Somente leitura**: nunca toma ciência nem abre o ato. Tarefa do Windows 06:40 e 12:40, dias úteis |

> [!CAUTION]
> **O robô do PJe só lê, de propósito.**
> Tomar ciência **dispara prazo**, e peticionar age em nome do advogado; por isso nenhuma das duas coisas foi implementada. Isso é uma trava de segurança deliberada, não uma pendência. Ampliar exige decisão do escritório, não só código.

O DJEN devolve HTTP 500 "sistema ocupado" com frequência; o cliente já trata com retry e backoff, paginação até 30 páginas e janela incremental com 2 dias de sobreposição.

---

## 🔧 Rodando localmente

**Pré-requisitos:** Node 20+, Docker Desktop. O certificado do PJe não entra aqui: fica no PC do robô (ver [Robô do PJe](#-robô-do-pje)).

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
FRONTEND_URL=                # opcional; origem do CORS (padrão: localhost:5180)
DISABLE_DJEN_CRON=           # true desliga a busca automática
```

O `.env.example` da raiz lista todas com comentários. O frontend não precisa de `.env` quando o backend roda em `localhost:3001`; em outro endereço, defina `VITE_API_URL` em `frontend/.env`.

> ⚠️ O Postgres do `docker-compose.yml` publica na porta **5433** (só nesta máquina, `127.0.0.1`), não 5432. A `DATABASE_URL` precisa refletir isso.

Para subir os dois processos de uma vez, use o `Iniciar_App.bat` na raiz. Ou manualmente, em dois terminais:

```bash
cd backend  && npm run dev          # :3001
cd frontend && npm run dev          # :5180
```

Testes: `npm test` nos dois projetos.

**Primeiro acesso:** o login é por e-mail e senha (sem Google/Firebase). Crie o primeiro administrador — a senha é pedida no terminal, sem aparecer:

```bash
cd backend && npm run criar-admin -- voce@jvo.adv.br "Seu Nome"
```

Depois, o admin cadastra o resto da equipe (nome, e-mail e senha inicial) em Prazos › ⋯ › **Equipe e acessos**, onde também desativa quem sai do escritório. Cada um troca a própria senha na aba Perfil.

---

## 🤖 Robô do PJe

Roda no PC de quem tem o certificado A1 (design: `docs/superpowers/specs/2026-10-30-robo-pje-local-design.md`). O servidor só recebe a lista de expedientes.

```bash
cd robo-pje
npm install
npm run robo-pje -- configurar   # endereço do Central, token do robô, .pfx, senha e segredo do 2FA
npm run robo-pje -- rodar        # lê agora e envia (mostra o resumo)
npm run robo-pje -- agendar      # tarefa do Windows: 06:40 e 12:40, segunda a sexta
npm run robo-pje -- esquecer     # apaga as credenciais deste PC
```

- **Token do robô:** gerado na aba **Perfil** do Central (aparece uma vez só; revogue lá se vazar). Só serve para pedir a vez e enviar a leitura — não abre o sistema.
- **Credenciais no PC:** cifradas com a proteção de dados do Windows (DPAPI) em `%APPDATA%\CentralJVO\robo.json` — só abrem naquele usuário, naquele PC. Nunca em `.env`.
- **Vários PCs, um certificado (o do Dr. Jesus):** antes de entrar no PJe o robô pede a **vez** ao servidor, que só concede se ninguém estiver lendo e a última leitura tiver mais de **10 minutos**. Assim logins em sequência não bloqueiam a conta do advogado, e vários PCs agendados às 06:40 leem uma vez só.
- **Endereço do Central:** com o servidor no mesmo PC, `http://localhost:3001`. Em outro PC, precisa de endereço fixo (o link temporário do Cloudflare muda a cada reinício).
- Log local: `%APPDATA%\CentralJVO\robo.log`. A última leitura (quando e por quem) aparece no topo do quadro; leitura atrasada acende a faixa vermelha.

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

- Login próprio (`src/infra/auth.js`): senha com scrypt, sessão de 30 dias em cookie httpOnly (o banco guarda só o SHA-256 do token), limite de tentativas por IP e por e-mail, e escrita recusada quando a requisição vem de outro site. Os limites ficam em memória (um processo só).
- Esqueceu a senha: o admin redefine em "Equipe e acessos" (não há recuperação por e-mail).

---

## 📁 Estrutura

```
backend/
  index.js                  API Express: config, admin, registro de rotas e crons
  config/
    djen.json               OABs monitoradas
  prisma/schema.prisma      5 models
  src/
    infra/                  prisma singleton, auth (senha + sessão), logger
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
