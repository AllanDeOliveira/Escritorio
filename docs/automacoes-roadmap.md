# Mapa de automações — escritório

**Data:** 2026-07-09
**Escopo:** automações que reduzem tempo de rotina. Segurança/auth é assunto separado
(ver as ressalvas ao final — nenhuma automação aqui conserta a autenticação).

Cada item traz a **base que já existe no código** (com referência de arquivo), o que falta,
esforço, dependências e o critério de pronto. Tudo verificado no repositório, não presumido.

---

## Estado atual: o que roda sozinho hoje

| Automação | Status |
|---|---|
| Cron 07:00 → digest Datajud no WhatsApp | ⚠️ Existe ([index.js:1223](../backend/index.js)) mas **aborta sempre** (ver abaixo) |
| Cron 06:30 → sync DJEN + heartbeat | ✅ Implementado (2026-07-09) |
| Consulta MNI/PJe | ❌ Só botão manual |
| Workers BullMQ (jurimetria) | ❌ Sob demanda, e só quando `RENDER` está setado |
| `runMonthlyNotifications` | ❌ O nome mente — não tem cron, é botão |

---

## O achado principal: features prontas e desligadas

`/api/processos` ([tribunalRoutes.js](../backend/src/routes/tribunalRoutes.js)) consulta o **Datajud**
e faz `lawsuit.upsert`. `/api/pieces` ([petitionRoutes.js](../backend/src/routes/petitionRoutes.js))
gerencia peças. **O frontend nunca chama nenhuma das duas** (verificado: `grep "api/processos\|api/pieces" frontend/src` → 0 resultados).

Cascata:

```
frontend nunca cria Lawsuit
  → tabela `acoes_judiciais` fica vazia
    → runDailyNotifications() acha 0 processos ATIVO e retorna
      → o cron das 07:00 não faz nada, todo dia
```

E o dado para preencher isso **já chega sozinho**: o sync do DJEN grava `numeroProcesso` e
`clienteExtraido` em toda intimação ([djenService.js:142-154](../backend/src/services/djenService.js)).

Tabelas que existem e nunca recebem uma linha: `Client` (0 usos), `Event` (0 usos),
`Organization` (0 usos).

---

## As automações

### A. Intimação → cria `Client` e `Lawsuit` automaticamente
**Esforço:** P–M · **Depende de:** nada · **Destrava:** cron 07:00, E, relatórios

- **Existe:** `clienteExtraido` e `numeroProcesso` em toda `Intimacao`; `lawsuit.upsert` em
  [tribunalRoutes.js:28](../backend/src/routes/tribunalRoutes.js); `Prazo.clientId`/`lawsuitId`/`responsibleId`
  são FKs reais e a API [já os aceita](../backend/src/routes/prazosRoutes.js) — o front nunca envia.
- **Falta:** no sync (ou no `gerar-prazo`), fazer upsert de `Client` por nome e `Lawsuit` por
  `caseNumber`, e ligar o `Prazo` criado.
- **Efeito composto:** popular `Lawsuit` **liga o cron das 07:00 que hoje é código morto**, sem
  nenhuma tela de cadastro e sem ninguém digitar nada.
- **Risco:** `clienteExtraido` é best-effort (regex sobre o teor, [djenService.js:51](../backend/src/services/djenService.js)).
  Nomes vão duplicar ("JOSE GOMES" vs "JOSÉ GOMES DA SILVA"). Upsert por nome **vai criar lixo**.
  → Chavear `Lawsuit` por `caseNumber` (é `@unique`, confiável). Para `Client`, ou aceitar revisão
  humana, ou não criar automaticamente e só sugerir.
- **Pronto quando:** gerar um prazo de uma intimação preenche `lawsuitId`; o cron das 07:00 passa a
  logar processos monitorados em vez de "Nenhum processo monitorado no DB".

### B. Data fatal calculada (dias úteis, feriados, recesso)
**Esforço:** M · **Depende de:** nada · **Destrava:** C

- **Existe:** **nada.** Verificado: 0 ocorrências de `addDays`/`dias úteis`/`feriado`/`businessDay`
  no repositório; nenhuma lib de data (date-fns/dayjs/luxon) usada em código-fonte. `fatalDate` é
  sempre digitado à mão ([PrazosTab.tsx:1016](../frontend/src/PrazosTab.tsx)) ou lido de planilha.
- **Falta:** contagem em dias úteis (CPC art. 219), recesso forense 20/12–20/01 (CPC art. 220),
  feriados nacionais (calculáveis: Páscoa → Carnaval, Sexta-Santa, Corpus Christi), feriados locais
  do tribunal (só via config manual — não há fonte automática confiável).
- **Risco:** é a automação de maior redução de risco **e** a de maior dano se errar. Feriado local
  faltando = prazo perdido. Exige tabela de feriados versionada e visível ao usuário.
- **Pronto quando:** dada uma data-base e um nº de dias úteis, a função devolve a data fatal
  pulando fins de semana, feriados e recesso — com teste cobrindo virada de ano e Carnaval.

### C. IA tria a intimação (sugere peça, prazo, base legal)
**Esforço:** M · **Depende de:** B (para entregar data, não só nº de dias)

- **Existe:** Gemini já lê texto jurídico em `/api/generate`; `prompts.js` com `SYSTEM_PROMPT`;
  a `Intimacao` guarda `texto`, `tipoDocumento`, `nomeClasse`.
- **Falta:** endpoint que recebe a intimação e devolve `{ tipoPeca, diasPrazo, baseLegal, confianca }`.
- **Nota:** o DJEN **não** manda prazo em dias nem tipo de ação exigida — só o teor. Toda inferência
  é da IA. Sem B, a IA entrega "15 dias úteis" e alguém ainda conta no calendário.
- **Risco (alto):** se a IA errar o número de dias, o sistema erra **com confiança**. Regra
  inegociável: **nunca gravar `fatalDate` sem confirmação humana**, sempre exibir a base legal citada
  e um aviso de que é sugestão. Um campo `confianca` baixo deve destacar, não esconder.
- **Pronto quando:** o modal "Gerar prazo" abre pré-preenchido, com a base legal à vista e o botão
  de confirmar ainda exigindo clique.

### D. Minuta automática da peça a partir da intimação
**Esforço:** M–G · **Depende de:** nada

- **Existe:** `/api/generate` (Gemini + Base de Conhecimento + docxtemplater) faz o trabalho pesado.
- **Falta:** botão "Gerar minuta" no card da intimação, passando teor + processo + modelos como contexto.
- **Ganho:** concentrado em quem redige, não na triagem.

### E. Distribuição automática por área → responsável
**Esforço:** M · **Depende de:** A (para ter `User` real como responsável)

- **Existe:** `Prazo.responsibleId` é FK para `User`. `areaDireito()` classifica em
  fazenda/previdenciário/bancário/trabalhista/cível.
- **⚠️ Correção:** `areaDireito()` vive **só no frontend** ([PrazosTab.tsx:129](../frontend/src/PrazosTab.tsx)),
  é calculada a cada render e **nunca persistida** — `Intimacao` não tem coluna `area`. O comentário
  no arquivo dizendo "espelho das regras do backend" está **desatualizado**: não existe `areaDireito`
  no backend (o "área" do jurimetria é `MonitoringArea`, conceito diferente). Atribuir responsável no
  momento do sync exige **mover/duplicar a classificação para o servidor**.
- **Falta:** classificação server-side + mapa área→advogado + preencher `responsibleId`.
- **Pronto quando:** prazo nasce atribuído, e existe uma visão "meus prazos".
- **✅ Feito (2026-09-25), por outro caminho:** a triagem é que se divide por área. Cada pessoa
  escolhe as próprias áreas (`User.areas`), a caixa abre em "Minhas áreas" e o prazo nasce com quem
  o gerou. A classificação continua no front — não foi preciso movê-la para o servidor.
  Ver [spec](superpowers/specs/2026-09-25-distribuicao-por-area-design.md).

### F. Agenda de audiências
**Esforço:** M · **Depende de:** nada

- **Existe:** model `Event` (title, type, urgency, date, time, lawsuitId, clientId) — **0 usos**.
- **⚠️ Dívida no schema:** `Event.date` é `String`, não `DateTime`. Corrigir antes de usar, ou herdar
  o problema de ordenação/comparação.
- **Nota:** audiência ≠ prazo. O DJEN traz "Intimação de pauta" (já cai no bucket `intimacao`).

---

## Dependências

```
A (Client/Lawsuit) ──┬─→ liga o cron 07:00 (Datajud)
                     ├─→ relatórios por cliente / processo
                     └─→ E (responsável real)

B (dias úteis) ──────→ C (IA entrega data fatal, não só "15 dias")

D (minuta)   independente
F (audiências) independente  (corrigir Event.date antes)
```

## Ordem recomendada

1. **A** — maior retorno do sistema. Não é feature nova, é *conectar* duas que já existem.
2. **B**, depois **C** — juntas eliminam a leitura + contagem manual, que é onde o tempo vai.
3. **D** ou **F**, conforme a dor.

---

## Dívidas a limpar (não são features)

- **`runMonthlyNotifications`** — sem cron, só botão. Agendar ou deletar; o nome mente.
- **`lastMovedBy`** é uma string que o próprio usuário digita. É anotação, **não auditoria**.
  Não há log imutável de quem concluiu ou excluiu prazo.
- **`DELETE /api/prazos/:id`** apaga de vez. Sem soft delete.
- **Cron das 07:00 sem `timezone`** — no Render (UTC) dispara às 03:00 de Cuiabá.
- **`Event.date` é `String`.**
- **Comentário desatualizado** em `PrazosTab.tsx:114` (ver E).

## Ressalvas

- Nenhuma automação aqui conserta a **autenticação**: `x-user-email` é spoofável e as rotas
  `/api/history*` não têm middleware nenhum. Automatizar em cima disso aumenta o volume de dado
  exposto, não diminui.
- **B e C tocam prazo fatal.** Confirmação humana obrigatória, base legal sempre visível.
- Não há **backup** verificável. Automação que grava mais dado num banco sem backup aumenta o que
  se perde.
