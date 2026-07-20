# Central JVO

Sistema interno de gestão jurídica do escritório: controle de prazos, geração de petições com IA, jurimetria preditiva baseada no DataJud/CNJ, monitoramento de intimações (DJEN) e integração com WhatsApp.

> Software proprietário de uso interno. Veja [LICENSE](LICENSE).

## Stack

- **Backend**: Node.js + Express, TypeScript/JavaScript misto, [Prisma](https://www.prisma.io/) (PostgreSQL), [BullMQ](https://bullmq.io/) (Redis) para filas assíncronas, [Gemini](https://ai.google.dev/) para geração/análise por IA
- **Frontend**: React + Vite + TypeScript, Firebase (autenticação)
- **Infra local**: Docker Compose (PostgreSQL + Redis + pgAdmin)

## Pré-requisitos

- Node.js ≥ 20
- Docker Desktop (Postgres + Redis)
- Chaves de API: Google Gemini, DataJud/CNJ (pública), Firebase

## Configuração

```bash
git clone https://github.com/AllanDeOliveira/Escritorio.git
cd Escritorio

# Sobe Postgres + Redis + pgAdmin
docker-compose up -d

# Variáveis de ambiente (raiz e/ou backend/frontend, conforme necessário)
cp .env.example .env
# preencha DATABASE_URL, REDIS_URL, GEMINI_API_KEY, DATAJUD_API_KEY, JWT_SECRET

# Instala dependências
cd backend && npm install && npm run db:generate && npm run db:push
cd ../frontend && npm install
```

## Rodando em desenvolvimento

Windows: `Iniciar_App.bat` na raiz sobe backend, worker e frontend numa janela só.

Manual (3 processos):

```bash
cd backend && npm run dev          # API Express (porta 3001)
cd backend && npm run dev:worker   # Worker BullMQ (filas de ingestão/análise)
cd frontend && npm run dev         # Vite dev server (porta 5173)
```

## Testes

```bash
cd backend && npm test
cd frontend && npm test
```

## Estrutura

```
backend/   API Express, filas BullMQ, adapters de integração (DataJud, DJEN, WhatsApp), schema Prisma
frontend/  SPA React (dashboard, prazos, jurimetria, geração de petições)
```

## Grafo de código (graphify)

Este projeto mantém um grafo de conhecimento do código em `graphify-out/`. Antes de explorar o código por grep manual, veja as regras em [CLAUDE.md](CLAUDE.md).
