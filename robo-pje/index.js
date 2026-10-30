// Robô do PJe no PC de quem tem o certificado (docs/superpowers/specs/2026-10-30-robo-pje-local-design.md).
// Lê o Painel do Advogado com o certificado DESTE PC e envia ao Central só a lista de expedientes:
// o servidor nunca vê certificado, senha do certificado nem segredo do 2FA.
//   npm run robo-pje -- configurar | rodar | agendar | esquecer
const path = require('path');
// ponytail: o código de leitura mora em backend/src; num PC sem o backend instalado, o node-forge
// está só em robo-pje/node_modules — NODE_PATH deixa o backend/src encontrá-lo.
process.env.NODE_PATH = [path.join(__dirname, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const fs = require('fs');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { lerPainel } = require('../backend/src/services/pjeLeitura');
const { lerPfx } = require('../backend/src/services/pjeSso');
const cred = require('./credenciais');

const TAREFA = 'Central JVO - Robo do PJe';

function registrar(linha) {
    console.log(linha);
    try {
        fs.mkdirSync(cred.PASTA, { recursive: true });
        fs.appendFileSync(cred.LOG, `${new Date().toLocaleString('pt-BR')}  ${linha}\n`);
    } catch { /* log local é ajuda, não pode derrubar a leitura */ }
}

async function chamar(cfg, metodo, rota, corpo, timeoutMs = 30_000) {
    const r = await fetch(`${cfg.servidor.replace(/\/+$/, '')}${rota}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const d = r.status === 204 ? {} : await r.json().catch(() => ({}));
    return { status: r.status, ...d };
}

// ── configurar ─────────────────────────────────────────────────────────────
async function configurar() {
    const atual = cred.carregar() || {};
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    let mudo = false;
    rl._writeToOutput = (s) => { if (!mudo) rl.output.write(s); }; // segredo digitado não aparece
    const linhas = rl[Symbol.asyncIterator]();
    async function perguntar(texto, { secreto = false, padrao } = {}) {
        process.stdout.write(`${texto}${padrao ? ` [${secreto ? 'Enter mantém o atual' : padrao}]` : ''}: `);
        mudo = secreto;
        const { value = '' } = await linhas.next();
        mudo = false;
        if (secreto) process.stdout.write('\n');
        const v = secreto ? value : value.trim(); // senha pode ter espaço nas pontas
        return v || padrao || '';
    }
    try {
        console.log('Robô do PJe — configuração deste PC (os segredos ficam protegidos pelo Windows).\n');
        const cfg = {
            servidor: await perguntar('Endereço do Central', { padrao: atual.servidor || 'http://localhost:3001' }),
            token: await perguntar('Token do robô (aba Perfil do Central)', { secreto: true, padrao: atual.token }),
            certificado: await perguntar('Caminho do certificado (.pfx)', { padrao: atual.certificado }),
            senhaPfx: await perguntar('Senha do certificado', { secreto: true, padrao: atual.senhaPfx }),
            segredoTotp: await perguntar('Segredo do 2FA do PJe (base32)', { secreto: true, padrao: atual.segredoTotp }),
        };
        rl.close();
        if (!cfg.token || !cfg.certificado || !cfg.senhaPfx) throw new Error('Token, certificado e senha do certificado são obrigatórios.');
        if (!fs.existsSync(cfg.certificado)) throw new Error(`Certificado não encontrado: ${cfg.certificado}`);
        // Confere antes de guardar: a senha abre o certificado? o Central aceita o token?
        const { cadeia } = lerPfx(fs.readFileSync(cfg.certificado), cfg.senhaPfx);
        const titular = cadeia[0].subject.getField('CN')?.value || '(sem nome)';
        console.log(`Certificado ok: ${titular}`);
        const r = await chamar(cfg, 'POST', '/api/intimacoes/pje/vez');
        if (r.status === 401) throw new Error('O Central recusou o token. Gere um novo na aba Perfil.');
        if (r.status === 200) await chamar(cfg, 'DELETE', '/api/intimacoes/pje/vez', { vez: r.vez }); // só testou: devolve a vez
        else if (![409, 429].includes(r.status)) throw new Error(`Central respondeu HTTP ${r.status}: ${r.error || ''}`);
        console.log(`Central ok: ${cfg.servidor}`);
        cred.salvar(cfg);
        console.log(`\nPronto. Credenciais guardadas em ${cred.ARQUIVO} (cifradas para este usuário do Windows).`);
        console.log('Próximos passos: "npm run robo-pje -- rodar" para testar e "npm run robo-pje -- agendar" para 06:40 e 12:40.');
    } finally {
        rl.close();
    }
}

// ── rodar ──────────────────────────────────────────────────────────────────
async function rodar() {
    const cfg = cred.carregar();
    if (!cfg) throw new Error('Robô não configurado neste PC. Rode: npm run robo-pje -- configurar');

    // 1. A vez: outro PC lendo agora, ou leitura há menos de 10 min → nem entra no PJe
    const v = await chamar(cfg, 'POST', '/api/intimacoes/pje/vez');
    if (v.status === 409 || v.status === 429) { registrar(`Sem leitura agora: ${v.error}`); return; }
    if (v.status !== 200) throw new Error(`O Central não deu a vez (HTTP ${v.status}): ${v.error || ''}`);

    // 2. Lê o painel com o certificado deste PC
    let tribunais;
    try {
        const pfx = fs.readFileSync(cfg.certificado);
        registrar('Lendo o Painel do Advogado (TJMT e TRF1, 1º e 2º grau)...');
        tribunais = await lerPainel({ pfx, senhaPfx: cfg.senhaPfx, segredoTotp: cfg.segredoTotp }, {
            info: (m) => console.log(m), warn: (m) => registrar(m),
        });
    } catch (e) {
        await chamar(cfg, 'DELETE', '/api/intimacoes/pje/vez', { vez: v.vez }).catch(() => {}); // devolve a vez
        throw e;
    }

    // 3. Envia só a lista de expedientes; o Central grava, cria e baixa os cards
    const r = await chamar(cfg, 'POST', '/api/intimacoes/pje/leitura', { versao: 1, vez: v.vez, tribunais }, 5 * 60_000);
    if (r.status !== 200) throw new Error(`O Central recusou a leitura (HTTP ${r.status}): ${r.error || ''}`);
    for (const t of r.resultado || []) registrar(`  ${t.tribunal}: ${t.erro ? `ERRO — ${t.erro}` : `${t.expedientes} expediente(s)`}`);
    const p = r.prazos || {};
    registrar(`Quadro: ${p.criados ?? 0} prazo(s) novo(s), ${p.atualizados ?? 0} data(s) atualizada(s), ${p.baixados ?? 0} cumprido(s) por sair do painel.`);
}

// ── agendar ────────────────────────────────────────────────────────────────
// Tarefa do Windows deste usuário (a proteção das credenciais é por usuário): 06:40 e 12:40,
// segunda a sexta; "executar assim que possível" se o PC estava desligado no horário.
function agendar() {
    const script = `
$acao = New-ScheduledTaskAction -Execute $env:ROBO_NODE -Argument ('"' + $env:ROBO_SCRIPT + '" rodar') -WorkingDirectory $env:ROBO_DIR
$dias = 'Monday','Tuesday','Wednesday','Thursday','Friday'
$gatilhos = @((New-ScheduledTaskTrigger -Weekly -DaysOfWeek $dias -At '06:40'), (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $dias -At '12:40'))
$cfg = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $env:ROBO_TAREFA -Action $acao -Trigger $gatilhos -Settings $cfg -Description 'Le o Painel do Advogado do PJe e envia ao Central JVO (robo-pje).' -Force | Out-Null`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, ROBO_NODE: process.execPath, ROBO_SCRIPT: path.join(__dirname, 'index.js'), ROBO_DIR: __dirname, ROBO_TAREFA: TAREFA },
        encoding: 'utf8', windowsHide: true,
    });
    if (r.status !== 0) throw new Error(`Não consegui criar a tarefa: ${(r.stderr || '').trim().slice(0, 300)}`);
    console.log(`Agendado: "${TAREFA}", segunda a sexta às 06:40 e 12:40 (roda assim que possível se o PC estava desligado).`);
    console.log(`Para tirar: Unregister-ScheduledTask -TaskName '${TAREFA}' -Confirm:$false`);
}

// ── esquecer ───────────────────────────────────────────────────────────────
function esquecer() {
    console.log(cred.esquecer() ? `Credenciais apagadas (${cred.ARQUIVO}).` : 'Não havia credenciais guardadas neste PC.');
    console.log(`Se havia agendamento, tire também: Unregister-ScheduledTask -TaskName '${TAREFA}' -Confirm:$false`);
}

const comandos = { configurar, rodar, agendar, esquecer };
const cmd = process.argv[2];
if (!comandos[cmd]) {
    console.log('Uso: npm run robo-pje -- configurar | rodar | agendar | esquecer');
    process.exitCode = 1;
} else {
    Promise.resolve(comandos[cmd]())
        .catch((e) => { registrar(`ERRO: ${e.message}`); process.exitCode = 1; });
}
