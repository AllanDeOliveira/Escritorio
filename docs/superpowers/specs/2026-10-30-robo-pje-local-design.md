# Robô do PJe no PC de quem tem o certificado

> **Decisões de 30/10/2026 (valem sobre o texto abaixo):**
> - **Um painel só.** Todo mundo usa o certificado do Dr. Jesus, então o item 3.2 (coluna
>   `painelUserId`, baixa por painel) **não é feito**. O código deixa escrito que é um painel só.
> - **Vez + tempo de espera, antes do login no PJe.** O robô pede a vez ao servidor
>   (`POST /api/intimacoes/pje/vez`). O servidor só concede se ninguém estiver lendo e se a
>   última leitura tiver mais de **10 minutos**; senão o robô sai sem entrar no PJe e mostra
>   quem leu e quando pode tentar de novo. Com a vez: lê, envia (`POST /api/intimacoes/pje/leitura`,
>   que libera a vez) ou desiste (`DELETE /api/intimacoes/pje/vez`). Vez esquecida expira sozinha.
>   Isso protege a conta do advogado de logins em sequência vindos de vários PCs, e faz vários
>   PCs agendados às 06:40 lerem uma vez só. Substitui o limite "1 envio a cada 5 min por painel" do 3.3.
> - **Servidor e certificado no mesmo PC hoje:** o robô envia para `http://localhost:3001`, então
>   não depende do domínio fixo do item 8 enquanto for assim.
> - Fase 2 (4.2, certificado do Windows sem `.pfx`) fica para depois.

**Objetivo:** o servidor do Central JVO nunca guarda certificado, senha do certificado nem segredo do 2FA. Quem tem o certificado A1 no próprio PC roda o robô ali; quem não tem, não roda. O servidor só recebe **o resultado da leitura** (a lista de expedientes) e continua criando e baixando os prazos como hoje.

---

## 1. Como é hoje

Tudo acontece no backend, em `backend/src/services/pjePainel.js`:

| Etapa | Onde | Precisa de |
|---|---|---|
| Login no SSO (certificado + TOTP) | `pjeSso.loginCertificado()`, que lê `MNI_CERT_PATH`, `MNI_CERT_SENHA` e `PJE_TOTP_SECRET` do `.env` | certificado |
| Leitura do painel, por tribunal | `lerTribunal()` → `lerExpedientes()` → `parseLista()` | sessão do PJe |
| Gravação | o laço dentro de `syncExpedientesPje()`: `upsert` em `expedientes_pje`, ajuste de `fatalDate`, `reabrirOsQueVoltaram()`, `darBaixaNosQueSairam()` | banco |
| Quadro | `gerarPrazosDoPje()` e `recordHeartbeat()` | banco |

Quem dispara: o cron das 06:40 e 12:40 (`index.js`), a rota `POST /api/intimacoes/sync-pje` e `recuperarRodadasPerdidas()` na subida.

**A divisão natural é:** login e leitura vão para o PC da pessoa; gravação e quadro ficam no servidor.

## 2. Como fica

```
PC de quem tem o certificado                         Servidor (Central JVO)
┌──────────────────────────────┐                    ┌───────────────────────────────┐
│ robo-pje (Node)              │                    │ POST /api/intimacoes/pje/leitura│
│ 1. certificado + TOTP do PC  │                    │   valida o corpo                │
│ 2. login SSO, lê o painel    │  HTTPS, só JSON    │   gravarLeitura()  (o laço de   │
│    dos 4 tribunais           │ ─────────────────► │   hoje: upsert, datas, baixa,   │
│ 3. envia { tribunais }       │  Bearer token      │   reabrir) + gerarPrazosDoPje() │
└──────────────────────────────┘  do robô           │   + heartbeat                   │
                                                    └───────────────────────────────┘
```

O DJEN não muda: continua no servidor, porque não usa certificado.

---

## 3. Mudanças no backend

### 3.1 Separar a leitura (sem banco) da gravação

1. Crie **`src/services/pjeLeitura.js`** com tudo que **não** usa `prisma`: `TRIBUNAIS`, `lerTribunal`, `lerExpedientes`, `parseLista`, `linksA4j`, `camposDoForm`, `escolherSituacoes`, `alvoPermitido`, `decodificar`, `teorEmTexto` etc. Esse arquivo vai rodar no PC da pessoa, então não pode importar `prismaClient`.
2. Em `lerExpedientes(pjeUrl, credenciais)`, passe as credenciais adiante: `loginCertificado({ pjeUrl, pfx, senhaPfx, segredoTotp })`. Os *defaults* de `loginCertificado` que leem `process.env.MNI_*` devem **sair** de `pjeSso.js`. Sem credenciais, ele tem que falhar com uma mensagem clara.
3. Exporte de `pjeLeitura.js` a função `lerPainel(credenciais)`: lê os tribunais em sequência; um tribunal fora do ar não derruba os outros (`{ tribunal, itens, incompletas }` ou `{ tribunal, erro }`).
4. Em `pjePainel.js`, troque `syncExpedientesPje()` por **`gravarLeitura(tribunais, { usuario })`**: é o mesmo laço de hoje, mas recebendo os itens prontos. Ele faz o `upsert`, ajusta `fatalDate`, roda reabrir/baixa só quando `!incompletas.length && itens.length`, chama `gerarPrazosDoPje()` e `recordHeartbeat()`. Serializa as gravações.
5. Apague `configurado()` e os usos dele (`index.js`, o cron das 06:40/12:40 e a rota `sync-pje`). O servidor deixa de ler o PJe; o `DISABLE_PJE_CRON` perde o sentido.

### 3.2 Mais de um certificado — **não feito** (ver decisões no topo)

O texto original previa a coluna `painelUserId` em `ExpedientePje` para que a leitura de um certificado não desse baixa nos expedientes de outro. Com um certificado só, a baixa continua por tribunal. Se um dia houver um 2º certificado, este item volta.

### 3.3 Rota que recebe a leitura

`POST /api/intimacoes/pje/leitura`:

- **Autenticação:** token do robô (3.4) ou a sessão normal.
- **Corpo:** `{ versao: 1, tribunais: [{ tribunal, itens, incompletas } | { tribunal, erro }] }`.
- **Valide tudo,** porque não dá para confiar no que chega:
  - `tribunal` precisa estar entre as siglas de `TRIBUNAIS`;
  - os itens só podem ter os campos do model (`idExpediente`, `numeroProcesso`, `tipo`, `destinatario`, `meio`, `orgao`, `partes`, `dataExpedicao`, `prazoDias`, `cienciaPendente`, `dataCiencia`, `dataLimite`, `situacao`, `jurisdicao`, `caixa`), e o resto é descartado;
  - as datas chegam como ISO, então converta com `new Date()` e recuse as inválidas;
  - limite de itens por tribunal (ex.: 5.000).
- **Tamanho:** `express.json({ limit: '1mb' })` é global. Para esta rota, `express.json({ limit: '10mb' })`, porque o campo `partes` pesa.
- **Resposta:** o mesmo `{ resultado, prazos }` que o `syncExpedientesPje` devolvia, para o robô mostrar o resumo.
- **Limite:** a vez + tempo de espera (decisões no topo).
- O robô roda fora do navegador e não manda `Origin`: a checagem de origem do `index.js` deixa passar.

### 3.4 Token do robô (em vez de guardar a senha do Central no PC)

- Model `TokenRobo { id, userId, hash, criadoEm, ultimoUsoEm, revogadoEm }`. Guarde só o SHA-256, como as sessões em `auth.js`.
- Na aba **Perfil**, botão **"Gerar token do robô do PJe"**. O token aparece uma vez só; no mesmo lugar dá para revogar.
- Middleware que aceita `Authorization: Bearer <token>` **só nas rotas do robô**: o token não serve para mais nada da API.
- No heartbeat, grave quem enviou (`pjeLastBy`) e quando.

---

## 4. O robô local (`robo-pje/` no repositório)

Pasta nova com `package.json` (depende de `node-forge`) e `index.js`, que importa `../backend/src/services/pjeLeitura.js` e `pjeSso.js`.

| Comando | Faz |
|---|---|
| `npm run robo-pje -- configurar` | Pergunta o endereço do Central, o token do robô, o caminho do `.pfx`, a senha do certificado e o segredo do 2FA. Guarda tudo **protegido** (4.1). |
| `npm run robo-pje -- rodar` | Pede a vez, carrega as credenciais, chama `lerPainel()` e faz o `POST` para `/api/intimacoes/pje/leitura`. Mostra o resumo e grava um log local. |
| `npm run robo-pje -- agendar` | Cria a tarefa do Windows: 06:40 e 12:40, de segunda a sexta, "executar assim que possível" se o PC estava desligado. Só com o usuário conectado (a proteção do 4.1 é por usuário). |
| `npm run robo-pje -- esquecer` | Apaga as credenciais guardadas. |

### 4.1 Onde ficam as credenciais no PC

**Nunca em `.env` nem em texto puro.** Proteção de dados do Windows (DPAPI): o que é cifrado só abre **naquele usuário, naquele PC**. Sem dependência nativa: PowerShell `ConvertTo-SecureString`/`ConvertFrom-SecureString`. JSON em `%APPDATA%\CentralJVO\robo.json`.

### 4.2 Certificado instalado no Windows, sem arquivo `.pfx` (fase 2, opcional)

Se o certificado está só no repositório do Windows e não é exportável, o `node-forge` não lê a chave. Dá para obter a cadeia e assinar o desafio pelo próprio Windows (`X509Store` + `GetRSAPrivateKey().SignData`), trocando `lerPfx` + `assinarDesafio` por uma interface `{ cadeia, assinar(mensagem) }`. Verificar se o provedor aceita MD5; senão, ver se o SSO aceita SHA-256. Comece com `.pfx`.

---

## 5. Tela

- O botão que chamava `sync-pje` sai. No lugar: **"Os prazos do PJe são lidos pelo robô no PC de quem tem o certificado. Última leitura: {quando} por {quem}."**
- **Aviso no painel** se a última leitura estiver atrasada (o robô parado num PC desligado precisa aparecer).
- Na aba Perfil: gerar e revogar o token do robô.

## 6. Testes (Vitest)

- `gravarLeitura`: leitura com `incompletas` não dá baixa; tribunal com `erro` não mexe nos expedientes dele.
- **Rota:** sem token → 401; token revogado → 401; token usado em outra rota → 401; tribunal desconhecido ou campo extra → 400 ou descartado; corpo grande → 413; vez ocupada / tempo de espera → recusa.
- **Leitura:** `pjeLeitura.js` não pode importar `prismaClient`.
- **`pjeSso`:** sem credenciais, falha com mensagem clara, sem procurar `process.env`.

## 7. Ordem

1. 3.1, com testes. 2. 3.3 e 3.4, com testes. 3. `robo-pje` (4 e 4.1). 4. Tela (5). 5. README: tirar `MNI_CERT_*`/`PJE_TOTP_SECRET` do `backend/.env` e explicar o robô local. 6. *(Opcional)* 4.2.

## 8. Atenção

- **Endereço do servidor:** o robô precisa saber para onde enviar. Num PC diferente do servidor, com o link temporário do Cloudflare, o robô para de funcionar a cada troca de link — isso depende do domínio fixo.
- **Continua somente leitura no PJe.** A trava `alvoPermitido()` vai junto para o PC, sem mudança.
- **O token do robô vazar** só permite enviar leituras falsas de expedientes e pedir a vez, nunca ler dados do sistema. Revogue na aba Perfil.
