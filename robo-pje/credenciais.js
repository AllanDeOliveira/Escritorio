// Credenciais do robô no PC: nunca em .env nem em texto puro. Proteção de dados do Windows
// (DPAPI, escopo do usuário): o que é cifrado aqui só abre NESTE usuário, NESTE PC — o
// arquivo copiado para outro lugar não serve para nada. Sem dependência nativa: PowerShell.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASTA = path.join(process.env.APPDATA || os.homedir(), 'CentralJVO');
const ARQUIVO = path.join(PASTA, 'robo.json');
const LOG = path.join(PASTA, 'robo.log');
const SECRETOS = ['token', 'senhaPfx', 'segredoTotp'];

// O valor vai por variável de ambiente (não aparece na linha de comando dos processos) e em
// base64 (o console do PowerShell 5.1 estraga acentos na volta).
function powershell(script, valor) {
    if (process.platform !== 'win32') throw new Error('O robô do PJe guarda as credenciais com a proteção do Windows: rode num PC Windows.');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, ROBO_VALOR: valor }, encoding: 'utf8', windowsHide: true,
    });
    if (r.status !== 0) throw new Error(`Proteção do Windows falhou: ${(r.stderr || '').trim().slice(0, 300)}`);
    return r.stdout.trim();
}

const proteger = (texto) => powershell(
    'ConvertTo-SecureString -String $env:ROBO_VALOR -AsPlainText -Force | ConvertFrom-SecureString',
    Buffer.from(String(texto), 'utf8').toString('base64'),
);

const abrir = (cifrado) => Buffer.from(powershell(
    '$s = ConvertTo-SecureString -String $env:ROBO_VALOR; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))',
    cifrado,
), 'base64').toString('utf8');

/** { servidor, certificado, token, senhaPfx, segredoTotp } → robo.json com os segredos cifrados */
function salvar(cfg) {
    fs.mkdirSync(PASTA, { recursive: true });
    const gravado = { versao: 1, servidor: cfg.servidor, certificado: cfg.certificado };
    for (const k of SECRETOS) gravado[k] = cfg[k] ? proteger(cfg[k]) : null;
    fs.writeFileSync(ARQUIVO, JSON.stringify(gravado, null, 2));
}

/** robo.json → credenciais em memória (null se o robô ainda não foi configurado neste PC) */
function carregar() {
    if (!fs.existsSync(ARQUIVO)) return null;
    const g = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    const cfg = { servidor: g.servidor, certificado: g.certificado };
    for (const k of SECRETOS) cfg[k] = g[k] ? abrir(g[k]) : null;
    return cfg;
}

function esquecer() {
    if (!fs.existsSync(ARQUIVO)) return false;
    fs.rmSync(ARQUIVO);
    return true;
}

module.exports = { salvar, carregar, esquecer, proteger, abrir, ARQUIVO, LOG, PASTA };
