/**
 * MNI (Modelo Nacional de Interoperabilidade) — TJMT, Fase 4.
 *
 * ⚠️ GUARDA DE SEGURANÇA — LEIA ANTES DE MEXER ⚠️
 * Este módulo implementa APENAS `consultarAvisosPendentes`, que LISTA os
 * expedientes pendentes de ciência SEM efetivá-la. As demais operações do
 * webservice são atos processuais com efeito jurídico e NÃO devem ser
 * adicionadas sem decisão expressa do escritório:
 *   - consultarTeorComunicacao  → EFETIVA A CIÊNCIA (dispara o prazo!)
 *   - confirmarRecebimento      → idem
 *   - entregarManifestacaoProcessual → PETICIONA em nome do advogado
 * Um robô que desse ciência em massa iniciaria centenas de prazos de uma vez.
 *
 * Autenticação: certificado A1 (mTLS via pfx) e/ou CPF+senha do PJe — o TJMT
 * aceita senhaConsultante vazia quando o certificado autentica a conexão.
 * Config via variáveis de ambiente (backend/.env, fora do git):
 *   MNI_URL        (opcional; padrão TJMT 1º grau)
 *   MNI_CPF        CPF do advogado consultante (obrigatório)
 *   MNI_SENHA      senha do PJe (opcional se houver certificado)
 *   MNI_CERT_PATH  caminho do .pfx/.p12 (opcional se houver senha)
 *   MNI_CERT_SENHA senha do certificado
 */
const fs = require('fs');
const https = require('https');
const { URL } = require('url');
const logger = require('../infra/logger');

const MNI_URL_PADRAO = 'https://pje.tjmt.jus.br/pje/intercomunicacao';

function lerConfig() {
    return {
        url: process.env.MNI_URL || MNI_URL_PADRAO,
        cpf: process.env.MNI_CPF || '',
        senha: process.env.MNI_SENHA || '',
        certPath: process.env.MNI_CERT_PATH || '',
        certSenha: process.env.MNI_CERT_SENHA || '',
    };
}

// O que falta para conseguir consultar (para a UI orientar a configuração)
function statusConfig() {
    const cfg = lerConfig();
    const faltando = [];
    if (!cfg.cpf) faltando.push('MNI_CPF');
    if (!cfg.senha && !cfg.certPath) faltando.push('MNI_SENHA ou MNI_CERT_PATH');
    if (cfg.certPath && !fs.existsSync(cfg.certPath)) faltando.push(`certificado não encontrado em ${cfg.certPath}`);
    if (cfg.certPath && fs.existsSync(cfg.certPath) && !cfg.certSenha) faltando.push('MNI_CERT_SENHA');
    return { configurado: faltando.length === 0, faltando };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Envelope SOAP 1.1 do consultarAvisosPendentes (MNI 2.2.2 / CNJ)
function montarEnvelopeAvisos({ cpf, senha = '', dataReferencia = null }) {
    const dataRef = dataReferencia ? `<tip:dataReferencia>${esc(dataReferencia)}</tip:dataReferencia>` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ser="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/"
                  xmlns:tip="http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2">
  <soapenv:Header/>
  <soapenv:Body>
    <ser:consultarAvisosPendentes>
      <tip:idConsultante>${esc(cpf)}</tip:idConsultante>
      <tip:senhaConsultante>${esc(senha)}</tip:senhaConsultante>
      ${dataRef}
    </ser:consultarAvisosPendentes>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// Datas MNI costumam vir como AAAAMMDDHHMMSS; normaliza para ISO quando possível
function normalizarDataMni(valor) {
    const s = String(valor || '').trim();
    const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?/);
    if (!m) return s || null;
    return `${m[1]}-${m[2]}-${m[3]}${m[4] ? `T${m[4]}:${m[5]}:${m[6]}` : ''}`;
}

// Extrai atributo OU elemento filho homônimo (as implementações variam)
function extrair(bloco, nome) {
    const attr = bloco.match(new RegExp(`(?:^|\\s)${nome}="([^"]*)"`));
    if (attr) return attr[1];
    const el = bloco.match(new RegExp(`<(?:[\\w.]+:)?${nome}[^>]*>([^<]*)<`));
    return el ? el[1].trim() : null;
}

/**
 * Parser tolerante da resposta do consultarAvisosPendentes.
 * Aceita variações de prefixo de namespace e campos como atributo ou elemento.
 */
function parseAvisosPendentes(xml) {
    const corpo = String(xml || '');

    const fault = corpo.match(/<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/i);
    if (fault) return { sucesso: false, mensagem: `SOAP Fault: ${fault[1].trim()}`, avisos: [] };

    const sucessoM = corpo.match(/<(?:\w+:)?sucesso[^>]*>\s*(true|false)\s*</i);
    const mensagemM = corpo.match(/<(?:\w+:)?mensagem[^>]*>([\s\S]*?)<\/(?:\w+:)?mensagem>/i);
    const sucesso = sucessoM ? sucessoM[1].toLowerCase() === 'true' : false;
    const mensagem = mensagemM ? mensagemM[1].trim() : null;

    const avisos = [];
    const blocos = corpo.match(/<(?:[\w.]+:)?aviso[\s>][\s\S]*?<\/(?:[\w.]+:)?aviso>/g) || [];
    for (const b of blocos) {
        const processoBloco = (b.match(/<(?:[\w.]+:)?processo[\s>][\s\S]*?(?:\/>|<\/(?:[\w.]+:)?processo>)/) || [''])[0];
        const orgaoBloco = (b.match(/<(?:[\w.]+:)?orgaoJulgador[^>]*(?:\/>|>[\s\S]*?<\/(?:[\w.]+:)?orgaoJulgador>)/) || [''])[0];
        const destBloco = (b.match(/<(?:[\w.]+:)?destinatario[\s>][\s\S]*?<\/(?:[\w.]+:)?destinatario>/) || [''])[0];
        avisos.push({
            idAviso: extrair(b, 'idAviso'),
            tipoComunicacao: extrair(b, 'tipoComunicacao'),
            dataDisponibilizacao: normalizarDataMni(extrair(b, 'dataDisponibilizacao')),
            numeroProcesso: extrair(processoBloco, 'numero'),
            classeProcessual: extrair(processoBloco, 'classeProcessual'),
            orgaoJulgador: extrair(orgaoBloco, 'nomeOrgao') || extrair(orgaoBloco, 'codigoOrgao'),
            destinatario: extrair(destBloco, 'nome'),
        });
    }

    return { sucesso, mensagem, avisos };
}

// POST SOAP com suporte a certificado cliente (A1 .pfx) — fetch não suporta pfx
function soapPost({ url, envelope, pfx, passphrase, timeoutMs = 60000 }) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                SOAPAction: '""',
                'Content-Length': Buffer.byteLength(envelope),
            },
            ...(pfx ? { pfx, passphrase } : {}),
            timeout: timeoutMs,
        }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('timeout', () => req.destroy(new Error(`timeout após ${timeoutMs}ms`)));
        req.on('error', reject);
        req.write(envelope);
        req.end();
    });
}

/**
 * Lista os expedientes pendentes de ciência do advogado configurado.
 * NÃO efetiva ciência — apenas a operação de listagem do MNI.
 */
async function consultarAvisosPendentes() {
    const cfg = lerConfig();
    const st = statusConfig();
    if (!st.configurado) {
        return { sucesso: false, configurado: false, faltando: st.faltando, avisos: [] };
    }

    const envelope = montarEnvelopeAvisos({ cpf: cfg.cpf, senha: cfg.senha });
    const pfx = cfg.certPath ? fs.readFileSync(cfg.certPath) : undefined;

    logger.info(`[MNI] consultando avisos pendentes em ${cfg.url} (CPF ${cfg.cpf.slice(0, 3)}***)`);
    const { status, body } = await soapPost({ url: cfg.url, envelope, pfx, passphrase: cfg.certSenha });

    const parsed = parseAvisosPendentes(body);
    if (status !== 200 && !parsed.avisos.length) {
        logger.warn(`[MNI] HTTP ${status}: ${(parsed.mensagem || body).slice(0, 300)}`);
    }
    return { ...parsed, configurado: true, httpStatus: status, consultadoEm: new Date().toISOString() };
}

module.exports = { consultarAvisosPendentes, statusConfig, montarEnvelopeAvisos, parseAvisosPendentes, normalizarDataMni };
