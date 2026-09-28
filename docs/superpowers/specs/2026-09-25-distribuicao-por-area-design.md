# Distribuição de intimações e prazos por área — Design

**Data:** 2026-09-25
**Objetivo:** Dividir a triagem das intimações e os prazos gerados entre a equipe, por área
do direito. Ao abrir a caixa, cada pessoa vê só as áreas que cuida; o prazo que ela gera
nasce no nome dela; no quadro, "Meus prazos" mostra só os dela.

## Contexto

- A caixa de intimações ([PrazosTab.tsx](../../../frontend/src/PrazosTab.tsx)) já tem filtro
  por área (`areaDireito()` + chips), mas a fileira é discreta e a área **Bancário nunca
  aparece**: só é detectada quando o nome da vara/classe contém "BANC". Nos dados reais,
  45 de 1.547 intimações têm banco como parte e hoje caem em Cível (ou Previdenciário, no
  caso da Caixa Econômica na Justiça Federal).
- `areaDireito()` roda **só no frontend**, a cada render, e não é persistida. A caixa carrega
  todas as intimações do mês e filtra no cliente — o filtro "minhas áreas" pode continuar
  no cliente, sem mover a classificação para o servidor.
- `Prazo.responsibleId` já é FK para `User`, e `GET/POST/PUT /api/prazos` já aceitam e
  devolvem o responsável (`include: responsible`). O front nunca envia o id: o campo
  "Responsável" do modal é texto livre, e o "Gerar prazo" o preenche com o advogado da
  publicação (quase sempre o mesmo nome).
- Usuários nascem sozinhos no primeiro login Google `@jvo.adv.br` (`POST /api/users/sync`).
  Hoje há 2 cadastrados. Não existe rota que liste a equipe para um membro comum.

## Decisões (definidas no brainstorming)

- **Divisão por área.** Cada pessoa faz a triagem das próprias áreas.
- **Uma área pode ter várias pessoas**, sem regra fixa: todas veem a mesma fila, e quem gerar
  o prazo fica com ele. Uma pessoa pode ter várias áreas.
- **Cada pessoa tem login próprio** e escolhe as próprias áreas.
- **Filtro, não bloqueio.** "Todas" fica sempre a um clique (férias, cobertura).
- **Colunas por tipo de ato ficam** (Intimações / Decisões / Sentenças / Despachos / Outros).
- **Painel inicial continua escritório-todo** (decisão do Dashboard Vivo mantida).

## Parte 1 — Área certa

### Bancário pela parte do processo

`areaDireito()` passa a receber também `texto` e marca **Bancário** quando o cabeçalho do teor
traz um banco **como parte**: um rótulo de polo seguido de nome de banco.

- Rótulos de polo: `REQUERID*`, `REQUERENTE`, `EXECUTAD*`, `EXEQUENTE`, `RÉU/REU`, `AUTOR*`,
  `APELAD*`, `APELANTE`, `RECORRID*`, `RECORRENTE`, `EMBARGAD*`, `EMBARGANTE`, `AGRAVAD*`,
  `AGRAVANTE`, `RECLAMAD*`, `IMPETRAD*`, `POLO ATIVO`, `POLO PASSIVO`, seguidos de `:` ou `-`.
- Nomes de banco logo após o rótulo: `BANCO`, `CAIXA ECONÔMICA/ECONOMICA`, `ITAÚ/ITAU`,
  `BRADESCO`, `SANTANDER`, `AGIBANK`, `BMG`, `CREFISA`, `NUBANK`, `SICREDI`, `SICOOB`,
  `AYMORÉ/AYMORE`.
- Só olha os **primeiros 2.000 caracteres** do teor (o cabeçalho das partes fica no topo; o
  teor inteiro pode ter vários KB e a função roda para centenas de cards).
- Um banco apenas **citado** no corpo ("depósito no Banco do Brasil", "Tema 1.414 cartão de
  crédito consignado") **não** marca Bancário.
- A regra antiga (vara/classe com "BANC") continua valendo.
- Ordem de prioridade: Trabalhista → Bancário → Previdenciário → Fazenda → Cível.

> **Decisão a confirmar — Caixa Econômica Federal.** Processos contra a CEF na Justiça
> Federal hoje caem em Previdenciário (regra "TRF → previdenciário"). Pela regra acima, viram
> **Bancário**. Padrão adotado: **Bancário**. Se a CEF deve ficar em Previdenciário, basta
> tirá-la da lista de bancos.

### Área calculada uma vez

A área de cada grupo é calculada uma vez por carga da lista (`useMemo` sobre `grupos`), não
a cada chip/contador/tecla digitada na busca.

### Fileira de área visível

```
Área:  [★ Minhas áreas (41)]  (Todas 396)  (Fazenda 282)  (Previdenciário 18)
       (Bancário 12)  (Trabalhista 16)  (Cível 68)  (Outras 0)   ✎ escolher minhas áreas
```

- A fileira ganha o rótulo **"Área:"** e chips um pouco maiores.
- **Todas as áreas aparecem sempre**; as com zero ficam apagadas e desabilitadas.

## Parte 2 — Minhas áreas

### Dados

- `User.areas String[] @default([])` — chaves de área (`'fazenda'`, `'bancario'`, …).
- Aplicado com `prisma db push` (fluxo atual do projeto, sem pasta de migrations). Coluna nova
  com default: não altera nem apaga dados existentes.
- O backend guarda a lista de chaves válidas numa constante própria
  (`fazenda, previdenciario, bancario, trabalhista, civel, outras`) — duplicata consciente da
  lista `AREAS` do front. Cada lista tem um comentário apontando para a outra; nada detecta
  divergência automaticamente, mas as chaves mudam raramente.

### API (em [userRoutes.js](../../../backend/src/routes/userRoutes.js), com `requireUser` por rota —
o router é montado sem middleware porque `/sync` roda antes do login)

| Rota | Faz |
|------|-----|
| `GET /api/users` | Lista a equipe: `[{ id, name, email }]`, ordenada por nome. |
| `PUT /api/users/me/areas` | Body `{ areas: string[] }`. Remove duplicadas; chave desconhecida → **400** listando as inválidas. Salva no usuário logado e devolve `{ success, areas }`. |

`POST /api/users/sync` já devolve o `user` inteiro, então `dbUser.areas` chega no login sem
mudança.

### Tela (caixa de intimações)

- Novo valor de filtro `'minhas'` em `intArea`. Estado local `minhasAreas` inicializado de
  `dbUser.areas` (sincronizado por `useEffect` quando `dbUser` chega depois do mount).
- **Abre em "Minhas áreas"** quando a pessoa tem áreas; senão abre em "Todas".
- Sem áreas escolhidas, o primeiro chip vira **"Escolher minhas áreas"** em destaque — é o
  convite, sem banner separado.
- "✎ escolher minhas áreas" abre um painel inline logo abaixo da fileira (mesmo padrão do
  painel MNI), com uma caixa de seleção por área e o botão **Salvar**. Salvar chama
  `PUT /api/users/me/areas`, atualiza `minhasAreas` e seleciona o chip "Minhas áreas".
- O filtro vale nas três abas (Novas / Viraram prazo / Descartadas).

## Parte 3 — O prazo nasce com dono

- O campo "Responsável" do modal vira um `<select>` com a equipe (`GET /api/users`, carregado
  uma vez ao montar a aba).
- **Gerar prazo:** vem selecionado **quem está logado** (hoje vem o advogado da publicação).
- **Novo prazo manual:** também vem selecionado quem está logado.
- **Editar prazo:** vem selecionado o `responsibleId` do prazo.
- O front envia `responsibleId` **e** `responsibleName` (nome do usuário escolhido), mantendo
  o texto que o card já exibe.
- `POST /api/intimacoes/:id/gerar-prazo` passa a gravar `responsibleId`: o enviado, ou o
  usuário logado se vier vazio. Id enviado que não existe → **400** (hoje estouraria a FK
  como 500).

## Parte 4 — Quadro: "Meus prazos"

```
Quadro de prazos        [ Meus prazos | Todos ]        [Importar planilha] [+ Novo Prazo]
```

- Alternador **Meus prazos / Todos**, filtrando no cliente por `responsibleId === dbUser.id`.
- Abre em **Meus prazos** quando a pessoa tem áreas escolhidas; senão em **Todos** (quem não
  participa da distribuição não abre num quadro vazio).
- O card já mostra `responsibleName`; nada muda nele.
- As contagens das colunas (Vencidos, Hoje…) e o resumo do cabeçalho seguem o filtro ativo.

## Parte 5 — Proteção contra trabalho em dobro

Com várias pessoas na mesma fila, hoje há duas brechas:

1. **Gerar em dobro:** `gerar-prazo` lê o status e só depois cria o prazo — dois cliques
   simultâneos passam na checagem e criam dois prazos.
2. **Descartar o que já virou prazo:** `descartar` não confere o status. Se A gera o prazo e B,
   com a tela desatualizada, clica "Descartar", a intimação fica DESCARTADA com prazo vivo.

Correção:

- **gerar-prazo** roda numa `prisma.$transaction`: primeiro "reivindica" a intimação com
  `updateMany({ where: { id, status: 'NOVA' }, data: { status: 'GERADA', … } })`. Se
  `count === 0`, aborta com **409**. Só então cria o prazo e grava `prazoId` no grupo. No
  Postgres, o `UPDATE` condicional trava a linha: a segunda transação espera, reavalia o
  `WHERE` e recebe `count 0`.
- **descartar** passa a usar `where: { id: { in: ids }, status: 'NOVA' }`. Se nada foi
  atualizado mas a intimação existe → **409**.
- Corpo do 409: `{ success: false, error: 'Esta intimação já foi tratada por <revisadoPor>.' }`.
- **Front:** `descartarIntimacao` passa a ler a resposta (hoje ignora e sempre mostra
  "Intimação descartada."). Em erro de gerar ou descartar: toast com a mensagem, fecha o modal
  e recarrega a lista.
- `restaurar` não muda.

## Casos de borda

- **Prazos antigos só com nome** (importados, `responsibleId` nulo): aparecem só em "Todos".
  Ao editar, o `<select>` inclui uma opção com o nome antigo, para não apagá-lo sem querer.
  (Hoje os 110 prazos no banco estão cancelados, então isso é raro.)
- **Pessoa da equipe que nunca logou:** não aparece na lista; basta entrar uma vez com o Google.
- **Falha ao salvar áreas:** toast de erro; o painel continua aberto com as marcações.
- **Falha ao carregar a equipe:** o `<select>` mostra só o usuário logado; gerar prazo continua
  funcionando.
- **Área sem ninguém:** nenhum aviso nesta versão (ver Fora de escopo).

## Fora de escopo (YAGNI)

- Painel inicial por pessoa — continua escritório-todo.
- Aviso por e-mail/WhatsApp ao responsável.
- Divisão por comarca, vara ou cliente.
- Bloqueio de acesso por área.
- Aviso de "área sem responsável" — adicionar se uma área ficar esquecida na prática.
- Persistir a área no servidor — só se um dia a distribuição precisar acontecer no sync.

## Verificação

- **Front ([PrazosTab.logic.test.ts](../../../frontend/src/PrazosTab.logic.test.ts)):**
  - banco como parte → `bancario` (Agibank como REQUERIDO, Bradesco como EXECUTADO, CEF
    como RECORRIDO);
  - banco só citado no corpo → mantém a área anterior;
  - Trabalhista vence Bancário.
- **Back:**
  - `gerar-prazo` numa intimação já GERADA → 409 e nenhum prazo novo criado;
  - `descartar` numa intimação já GERADA → 409 e status inalterado;
  - `PUT /api/users/me/areas` com chave inválida → 400; com chaves válidas repetidas → salva
    sem duplicar.
- **Dados reais:** rodar a nova `areaDireito` sobre as 1.547 intimações e conferir que as ~45
  com banco como parte viram Bancário, sem arrastar processos da Fazenda.
- **Build:** `tsc` e build do front passam; testes do back passam.
