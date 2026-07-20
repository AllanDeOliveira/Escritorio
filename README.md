# Central JVO ⚖️

Sistema interno do escritório para **geração de peças com IA, controle de prazos e jurimetria preditiva**. Reúne num só lugar o que antes estava espalhado entre planilhas, o PJe e a caixa de intimações.

> [!IMPORTANT]
> **Uso interno. Repositório privado.** O sistema lida com dados de processos e clientes — veja [Dados sensíveis](#-dados-sensíveis) antes de mexer.

---

## 📦 Módulos

**Gerar Impugnação** — sobe o PDF/DOCX da contestação e o sistema redige a impugnação em dois estágios:

1. **Extração** (Gemini Flash Lite) — varre a peça do réu e devolve os fatos estruturados: probabilidade de êxito, estratégia, mapa de contradições, matriz de duelo tópico a tópico, documentos adversos, mapa de riscos. **O advogado revisa esses fatos na tela antes de seguir.**
2. **Redação** (Gemini Pro) — escreve a peça a partir dos fatos confirmados, usando a base de conhecimento do escritório como referência de tese e tom.

PDFs e imagens vão para a File API do Gemini, que faz OCR nativo. DOCX é extraído com `mammoth`.

**Base de conhecimento** — peças `.docx` anteriores do escritório, injetadas nos prompts como fonte de teses vencedoras e estilo argumentativo, com instrução explícita de não copiar dados pessoais.

**Dossiê** — histórico de tudo que foi gerado, com edição, favoritos e comparação entre versões (a IA compara duas ou mais e aponta a melhor).

**Controle de prazos** — kanban com arrastar e soltar, prazo fatal separado do interno, auditoria de quem moveu e quando. Importa planilha `.xlsx`/`.csv` em dois formatos: o modelo padrão baixável pelo sistema e o formato "Publicações Processuais" do escritório, detectado automaticamente.

**Caixa de intimações (DJEN)** — sincroniza as comunicações por OAB, agrupa cópias do mesmo ato, e cada intimação vira prazo ou é descartada, com possibilidade de restaurar.

**Jurimetria preditiva** — monitora tribunal + assunto (código TPU) e roda um pipeline assíncrono que descobre, ingere e analisa processos do DataJud.

> Volume e tendência são calculados **no banco**, com SQL. A IA só enriquece qualitativamente — polo passivo, resumo, fundamentos — e **nunca produz números**. O radar de precedentes vem de busca real no índice do STJ.

**Produtividade e admin** — estatísticas por usuário, edição do prompt do sistema pela interface, central de WhatsApp.

---

## 🏗️ Arquitetura

Três processos:

| Processo | Comando | Porta | Papel |
|---|---|---|---|
| **API** | `npm run dev` (em `backend/`) | 3001 | Express, rotas `/api/*`, cron diário, cliente WhatsApp |
| **Worker** | `npm run dev:worker` (em `backend/`) | — | 4 workers BullMQ consumindo Redis |
| **Frontend** | `npm run dev` (em `frontend/`) | 5173 | Vite |

**Pipeline da jurimetria:**

```
POST /api/monitoring
      │
      ▼
 discoveryQueue ──► busca CNJs recentes no DataJud, filtra os já conhecidos
      │
      ▼
 ingestionQueue ──► baixa o processo completo, grava em transação
      │
      ▼
 analysisQueue  ──► agrega métricas por assunto, enriquece com IA, busca radar no STJ
      │
      ▼
 outcomeQueue   ──► sob demanda: classifica desfechos de uma tese
```

As filas de análise usam 50 tentativas com backoff fixo de 60s — dimensionado para o *rate limit* do DataJud, não é exagero.

**Em produção (Render)** o worker **não** roda separado: a API o carrega no mesmo processo quando detecta a variável `RENDER`. O WhatsApp fica desligado nesse ambiente, porque o Chromium não sobe lá.

---

## 🛠️ Stack

**Backend** — Node 20+, Express 5, Prisma 5 + PostgreSQL, BullMQ 5 + Redis, `@google/genai`, `whatsapp-web.js` + Puppeteer, `mammoth`, `pdf-parse`, `docxtemplater`, `xlsx`, `node-cron`, `pino`, `zod`. Testes em Vitest.

> `index.js` é CommonJS; `src/worker` e `src/shared` são TypeScript/ESM compilados por `tsc` para `dist/`. A convivência é intencional, mas é bom saber antes de mover arquivo de lugar.

**Frontend** — React 18 + Vite 6 + TypeScript, Firebase Auth (Google), `framer-motion`, `react-markdown`, `react-quill`. Sem router: navegação por aba, com estado persistido em localStorage.

**Banco** — PostgreSQL via Prisma, 20 models com nomes de tabela em português.

**Infra local** — Docker Compose (PostgreSQL + Redis + pgAdmin).

---

## 🔌 Integrações

| Serviço | O que faz |
|---|---|
| **DataJud / CNJ** | API pública Elasticsearch. Busca processo por CNJ, busca por tribunal + assunto, e busca de precedentes no índice do STJ |
| **DJEN / Comunica PJe** | Intimações por OAB, sem autenticação. As OABs monitoradas ficam em `backend/config/djen.json` |
| **Google Gemini** | Flash Lite para extração e enriquecimento, Pro para redação da peça, Flash Lite para mensagens de WhatsApp |
| **WhatsApp** | `whatsapp-web.js` com sessão local. Notificação diária às 07:00, relatório do kanban, aviso a cada peça gerada |
| **MNI / PJe (TJMT)** | SOAP com certificado A1 (mTLS). Consulta avisos pendentes |
| **Firebase Auth** | Login com Google no frontend |

> [!CAUTION]
> **O MNI implementa apenas a consulta de avisos pendentes, de propósito.**
> `consultarTeorComunicacao`, `confirmarRecebimento` e `entregarManifestacaoProcessual` foram omitidos porque efetivam ciência — o que **dispara prazo** — ou peticionam em nome do advogado. Isso é uma trava de segurança deliberada, não uma pendência. Ampliar exige decisão do escritório, não só código.

O DJEN devolve HTTP 500 "sistema ocupado" com frequência; o cliente já trata com retry e backoff, paginação até 30 páginas e janela incremental com 2 dias de sobreposição.

---

## 🔧 Rodando localmente

**Pré-requisitos:** Node 20+, Docker Desktop, Google Chrome instalado (só para o robô de WhatsApp), chaves do Gemini e do DataJud.

```bash
docker-compose up -d      # postgres :5433, redis :6379, pgadmin :5050

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
REDIS_URL=
PORT=
GEMINI_API_KEY=
GEMINI_JURIMETRIA_API_KEY=   # opcional, cai no GEMINI_API_KEY
DATAJUD_API_KEY=
MNI_URL=                     # opcional, default TJMT 1º grau
MNI_CPF=
MNI_SENHA=
MNI_CERT_PATH=
MNI_CERT_SENHA=
DISABLE_WHATSAPP=
LOG_LEVEL=
```

E `frontend/.env`:

```env
VITE_API_URL=
VITE_LEGACY_API_URL=
```

> ⚠️ O Postgres do `docker-compose.yml` publica na porta **5433**, não 5432. A `DATABASE_URL` precisa refletir isso.

Para subir os três processos de uma vez, use o `Iniciar_App.bat` na raiz. Ou manualmente, em três terminais:

```bash
cd backend  && npm run dev          # :3001
cd backend  && npm run dev:worker
cd frontend && npm run dev          # :5173
```

Testes: `npm test` nos dois projetos.

---

## 🔐 Dados sensíveis

Este repositório **não versiona** — e não deve voltar a versionar:

```
backend/.env                  chaves de API e string do banco
backend/modelos/              peças reais, com nome de cliente e parte adversa
backend/config/escritorio.json
backend/src/.wwebjs_auth/     sessão ativa do WhatsApp
backend/prisma/*.db
```

O `.gitignore` já cobre tudo isso. Antes de adicionar exceção com `!`, considere que uma regra de negação cancela as regras anteriores — foi assim que peças de clientes acabaram versionadas por engano no passado.

`backend/modelos/` é criada automaticamente pelo backend e populada pela interface. Não precisa estar no git.

---

## 🚧 Limitações conhecidas

- **A autenticação do backend não é autenticação de verdade.** O frontend faz login por Firebase, mas o backend só recebe o e-mail no header `x-user-email` e confere se existe um usuário com aquele e-mail. Quem souber o e-mail de alguém da equipe consegue se passar por essa pessoa. Fechar isso exige validar o token com o Firebase Admin SDK.
- `cors()` está aberto, sem allowlist de origem.
- A config do Firebase está fixa no código do frontend, não parametrizada por ambiente.
- `render.yaml` embute um hostname de Redis literal em vez de referência.
- Localmente API e worker são processos separados; no Render compartilham o mesmo. Comportamento sob carga difere entre os dois ambientes.

---

## 📁 Estrutura

```
backend/
  index.js                  API Express: geração, modelos, histórico, analytics, admin
  prompts.js                prompt do sistema e auxiliares
  docx-ooxml-parser.js      Markdown → OOXML para download .docx
  config/
    system_prompt.txt       prompt principal, editável pelo admin na UI
    djen.json               OABs monitoradas
  prisma/schema.prisma      20 models
  src/
    infra/                  prisma singleton, filas BullMQ, logger
    middleware/             requireUser, requireAdmin
    routes/                 prazos, intimacoes, jurimetria, mni, petition, tribunal, user, whatsapp
    services/               djen, mni, whatsapp, notification, tribunal, aiUsage
    shared/adapters/        adapter do DataJud
    worker/
      worker.ts             entrypoint dos 4 workers
      queues/               ingestion, discovery, analysis, outcome
frontend/src/
  App.tsx                   shell e navegação por abas
  GerarTab / DossierTab / PrazosTab / ModelosTab / Jurimetria /
  ProductivityPanel / AdminPanel / WhatsAppCenter
docker-compose.yml          postgres, redis, pgadmin
render.yaml                 deploy do backend
Iniciar_App.bat             sobe os três processos numa janela
```

---

## 🧭 Grafo de código (graphify)

Este projeto mantém um grafo de conhecimento do código em `graphify-out/`. Antes de explorar por grep manual, veja as regras em [CLAUDE.md](CLAUDE.md).

---

## 📄 Uso

Software de uso interno. Todos os direitos reservados. A titularidade dos direitos patrimoniais ainda não foi formalizada neste repositório.
