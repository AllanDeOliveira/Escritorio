# Dashboard Vivo — Design

**Data:** 2026-07-09
**Objetivo:** Transformar a "Página Inicial" (hoje só botões de navegação) num painel de
situação do escritório: ao logar, o usuário vê imediatamente prazos vencidos/hoje/semana,
intimações novas e últimos processos. Foco em **visibilidade e controle**.

## Contexto

A home atual ([App.tsx:727-780](../../../frontend/src/App.tsx)) é um grid de 6 botões de
acesso rápido, sem nenhum dado. Numa ferramenta de gestão de prazos, isso desperdiça a tela
mais vista do sistema. Todos os dados necessários já são expostos por endpoints existentes —
esta é uma feature **puramente de frontend**, zero mudança no backend.

## Decisões (definidas no brainstorming)

- **Escopo:** escritório todo (não filtra por responsável).
- **Navegação:** os próprios cartões de estatística são a navegação (clicar em "Vencidos"
  abre a aba Prazos). Os 6 botões de acesso rápido antigos são **removidos**.
- **Pacote inclui:** painel de situação na home + badge na sidebar + banner de alerta.

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  ⚠  3 prazos vencidos · 2 vencem hoje                     │ ← banner: só se crítico > 0
├────────────────┬────────────────┬────────────────────────┤
│  VENCIDOS      │  HOJE          │  ESTA SEMANA           │ ← cards clicáveis
│      3         │      2         │       5                │   → abre Prazos (board)
│  vermelho      │  âmbar         │  neutro                │
├────────────────┴────────────────┴────────────────────────┤
│  📥 Intimações novas no DJEN              [ 5 ]  →        │ ← → abre Prazos (inbox)
├───────────────────────────────────────────────────────────┤
│  Últimos processos                                        │
│   • Silva vs Banco X       · 08/07                   →    │ ← → abre Dossiê do caso
│   • Souza (aposentadoria)  · 07/07                   →    │
└───────────────────────────────────────────────────────────┘
```

- **Banner de alerta:** aparece só quando `vencido + hoje > 0`. Vermelho, no topo da home.
- **Cards de estatística:** Vencidos (vermelho), Hoje (âmbar), Esta semana (neutro). Cada
  um é clicável e leva à aba Prazos.
- **Card de intimações:** mostra `counts.nova`; clicar abre a aba Prazos direto na caixa
  de entrada (view `inbox`).
- **Últimos processos:** 5 casos mais recentes (por `createdAt`); clicar abre o dossiê.
- **Saudação** ("Bem-vindo, Dr. X") vira uma linha fina de cabeçalho, não um bloco grande.
- **Badge na sidebar:** o item "Prazos" ganha um badge vermelho = `vencido + hoje`, visível
  em **qualquer aba** (consciência ambiente sem estar na home).

## Arquitetura

Segue o padrão de componentes que o projeto já usa (`PrazosTab`, `DossierTab`, `GerarTab`
são componentes de aba separados que recebem props do `App`).

### `DashboardTab.tsx` (novo)
Componente de apresentação puro. Não busca dados.

Props:
- `resumo: { vencido: number; hoje: number; semana: number; novas: number } | null`
- `recentes: Array<{ id; clientName; caseNumber; createdAt; title }>`
- `loading: boolean`
- `erro: boolean`
- `nomeUsuario: string`
- `onNavigate(tab: string, opts?: { view?: 'board' | 'inbox'; caseId?: string }): void`

Renderiza banner, cards, card de intimações e lista de recentes a partir das props.

### `App.tsx` (mudanças)
- Remove o bloco inline da home (linhas ~727-780) e o substitui por `<DashboardTab .../>`.
- Novo estado `resumo`, `recentes`, `resumoLoading`, `resumoErro`.
- Busca o resumo **no login** (necessário para o badge da sidebar funcionar em qualquer
  aba) e ao voltar para a home; refresh periódico via `setInterval` (mesmo padrão do
  `checkSystemStatus` existente, ~5 min).
- Badge no botão "Prazos" da sidebar ([App.tsx:615](../../../frontend/src/App.tsx)):
  `resumo.vencido + resumo.hoje`, escondido quando 0 ou em erro.
- `onNavigate` mapeia: `'prazos'` → `setActiveTab('prazos')` (+ view opcional);
  `'dossier'` com `caseId` → reusa `carregarCaso(id)` que já existe.

### `PrazosTab.tsx` (mudança mínima)
- Nova prop opcional `initialView?: 'board' | 'inbox'`, consumida uma vez para inicializar
  o estado `view`. Permite o deep-link do card de intimações cair direto na caixa.

## Dados

Nenhum endpoint novo. Reuso dos que o frontend já consome:

| Dado | Endpoint | Uso |
|------|----------|-----|
| Contagem de prazos | `GET /api/prazos` | agrupar por `bucket` → vencido/hoje/semana |
| Intimações novas | `GET /api/intimacoes?status=NOVA` | `counts.nova` |
| Últimos processos | `GET /api/history` | 5 mais recentes (ordenar por `createdAt` desc) |

Função pura `resumoDePrazos(prazos)` → `{ vencido, hoje, semana }` conta por `bucket`.
É o único trecho com lógica; leva um teste (`test_*` com asserts, sem framework pesado).

## Casos de borda

- **Falha no fetch (crítico):** NÃO exibir "0 vencidos" — exibir estado de erro explícito
  ("não foi possível carregar · atualizar"). Esconder um vencido real atrás de um zero
  falso é risco de perda de prazo. O badge da sidebar **some** no erro, nunca zera.
  A guarda fica no `DashboardTab`: `erro` vence sobre `resumo`, então mesmo que o `App`
  um dia passe números junto com `erro=true`, a UI se recusa a exibi-los. Duas regressões
  cobrem isso (validadas por mutação: quebram se a guarda enfraquecer).
- **Sem prazos / sem histórico:** estados vazios amigáveis ("Nenhum prazo em aberto ·
  tudo em dia").
- **`activeTab` restaurado do localStorage:** o usuário pode cair em outra aba ao logar;
  por isso o badge da sidebar (sempre visível) cobre o alerta, não só o banner da home.

## Fora de escopo (YAGNI)

- Store/cache compartilhado entre Dashboard e PrazosTab — os 2 fetches duplicados não
  justificam. Adicionar só se virar problema de performance medido.
- Filtro por responsável / visão "meus prazos" — decidido escritório-todo.
- Visão calendário — feature separada, spec própria se for adiante.

## Verificação

- Teste unitário de `resumoDePrazos` (contagem por bucket, incluindo bucket desconhecido).
- Testes de render (`react-dom/server`, sem dependência nova) para o estado de erro, o
  banner crítico (plural/singular) e o badge de intimações.
- **Ainda não feito:** exercício ponta-a-ponta na UI com dados reais — exige backend,
  Firebase Auth e banco no ar. Cobertura estática (tsc, build, transform via Vite) e
  testes passam.

## Limpeza incluída

Remoção do CSS órfão deixado pelo launcher grid antigo em `index.css`:
`app-launcher-*`, `app-dashboard-panel`, `app-dashboard-content`, `app-dash-welcome`,
`app-dash-subtitle`, `lx-dash-header`.
