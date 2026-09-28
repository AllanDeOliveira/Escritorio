const fs = require('fs');
const path = require('path');
const logger = require('../infra/logger');
const prisma = require('../infra/prismaClient');

const API_BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const CONFIG_PATH = path.join(__dirname, '../../config/djen.json');
const DEFAULT_CONFIG = {
    oabs: [{ numero: '9309', uf: 'MT' }],
    advogados: [{ nome: 'JESUS VIEIRA DE OLIVEIRA', oab: '9309', uf: 'MT' }],
    diasBackfill: 14,
};

function lerConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
        }
    } catch (e) {
        logger.warn('[DJEN] config/djen.json inválido, usando padrão:', e.message);
    }
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2)); } catch (e) { /* opcional */ }
    return { ...DEFAULT_CONFIG };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Busca uma página da API Comunica com retry + backoff. A API do DJEN devolve
 * HTTP 500 "sistema muito ocupado" com frequência — não é erro nosso, é fila;
 * insistir com espera crescente resolve na prática.
 */
async function fetchPagina(params, tentativas = 5) {
    const url = `${API_BASE}?${new URLSearchParams(params)}`;
    for (let i = 1; i <= tentativas; i++) {
        try {
            const r = await fetch(url, { headers: { Accept: 'application/json' } });
            const body = await r.json().catch(() => null);
            if (r.ok && body && body.status === 'success') return body;
            logger.warn(`[DJEN] tentativa ${i}/${tentativas} (HTTP ${r.status}): ${body?.message || 'sem corpo'}`);
        } catch (e) {
            logger.warn(`[DJEN] tentativa ${i}/${tentativas} erro de rede: ${e.message}`);
        }
        await sleep(2000 * i);
    }
    return null;
}

/**
 * Melhor esforço para extrair o nome da parte (cliente) da comunicação.
 * O campo destinatarios às vezes vem mascarado ("USUÁRIO DO SISTEMA"); nesse
 * caso tentamos o teor, que costuma trazer "REQUERENTE: FULANO ...".
 * A revisão é humana (manual assistido), então imperfeição aqui é aceitável.
 */
function extrairCliente(item) {
    try {
        const dest = Array.isArray(item.destinatarios) ? item.destinatarios : [];
        const ativo = dest.find((d) => d.polo === 'A') || dest[0];
        if (ativo?.nome && !/USU[AÁ]RIO DO SISTEMA/i.test(ativo.nome)) return String(ativo.nome).trim();
    } catch (e) { /* segue para o teor */ }

    const texto = String(item.texto || '');
    const m = texto.match(
        /(?:REQUERENTE|RECORRENTE|AUTORA?|EXEQUENTE|APELANTE|IMPETRANTE|RECLAMANTE|EMBARGANTE|AGRAVANTE)\s*[:\-]\s*(.{3,80}?)(?=\s+(?:REPRESENTANTE|ADVOGADOS?|RECORRIDOS?A?|REQUERIDOS?A?|R[ÉE]US?|EXECUTADOS?A?|APELADOS?A?|CPF|CNPJ|OAB)\b|[.;\n]|$)/i
    );
    return m ? m[1].trim() : null;
}

/**
 * A busca por número da API só casa a OAB escrita de forma idêntica, e cada
 * tribunal escreve do seu jeito ("9309-O", "9309/O", "9309-A", "12981/O-O"...).
 * A busca por nome pega todas as grafias, mas traz homônimos do país inteiro:
 * vale só a publicação em que algum advogado tem a nossa OAB (mesmos dígitos + UF).
 */
function ehDoAdvogado(item, adv) {
    const advs = Array.isArray(item.destinatarioadvogados) ? item.destinatarioadvogados : [];
    return advs.some((d) =>
        String(d.advogado?.numero_oab || '').replace(/\D/g, '') === String(adv.oab)
        && String(d.advogado?.uf_oab || '').toUpperCase() === String(adv.uf).toUpperCase());
}

function extrairAdvogado(item) {
    try {
        const advs = Array.isArray(item.destinatarioadvogados) ? item.destinatarioadvogados : [];
        const a = advs[0]?.advogado;
        if (a?.nome) return String(a.nome).trim();
    } catch (e) { /* sem advogado estruturado */ }
    return null;
}

/**
 * Sincroniza comunicações do DJEN para a tabela Intimacao.
 * Janela de busca: `dias` explícito, ou incremental (última data gravada - 2
 * dias de sobreposição; a dedupe por djenId torna a sobreposição inócua), ou
 * o backfill configurado quando a tabela está vazia.
 *
 * Corpo interno: não grava heartbeat. Use `syncIntimacoes` (que envolve esta).
 */
async function executarSync({ dias } = {}) {
    const cfg = lerConfig();
    const hoje = new Date();
    let inicio;

    if (dias && Number(dias) > 0) {
        inicio = new Date(hoje);
        inicio.setDate(inicio.getDate() - Number(dias));
    } else {
        const ultima = await prisma.intimacao.aggregate({ _max: { dataDisponibilizacao: true } });
        if (ultima._max.dataDisponibilizacao) {
            inicio = new Date(ultima._max.dataDisponibilizacao);
            inicio.setDate(inicio.getDate() - 2);
        } else {
            inicio = new Date(hoje);
            inicio.setDate(inicio.getDate() - (cfg.diasBackfill || 14));
        }
    }

    const fmt = (d) => d.toISOString().slice(0, 10);
    const resultado = { criadas: 0, jaExistiam: 0, total: 0, janela: `${fmt(inicio)} a ${fmt(hoje)}`, oabs: [], erros: [] };

    // Por OAB (grafias conhecidas) e por nome do advogado (qualquer grafia que o
    // tribunal use). A dedupe por djenId junta o que as duas buscas repetem.
    const consultas = [
        ...(cfg.oabs || []).map((oab) => ({
            rotulo: `OAB ${oab.numero}/${oab.uf}`,
            params: { numeroOab: String(oab.numero), ufOab: String(oab.uf) },
            origem: `${oab.numero}/${oab.uf}`,
            aceita: () => true,
        })),
        ...(cfg.advogados || []).map((adv) => ({
            rotulo: `advogado ${adv.nome}`,
            params: { nomeAdvogado: String(adv.nome) },
            origem: `${adv.oab}/${adv.uf} (por nome)`,
            aceita: (item) => ehDoAdvogado(item, adv),
        })),
    ];

    for (const consulta of consultas) {
        let pagina = 1;
        let coletadas = 0;
        let count = Infinity;

        while (coletadas < count && pagina <= 30) {
            const body = await fetchPagina({
                ...consulta.params,
                dataDisponibilizacaoInicio: fmt(inicio),
                dataDisponibilizacaoFim: fmt(hoje),
                pagina: String(pagina),
                itensPorPagina: '100',
            });

            if (!body) {
                resultado.erros.push(`${consulta.rotulo}: API indisponível (página ${pagina})`);
                break;
            }

            count = body.count ?? 0;
            const items = body.items || [];
            if (items.length === 0) break;

            for (const item of items) {
                if (!consulta.aceita(item)) continue; // homônimo de outra OAB/UF
                resultado.total++;
                const djenId = String(item.id);
                const existe = await prisma.intimacao.findUnique({ where: { djenId } });
                if (existe) {
                    resultado.jaExistiam++;
                    // Backfill: registros criados antes de guardarmos o hash da certidão
                    if (!existe.hash && item.hash) {
                        await prisma.intimacao.update({ where: { djenId }, data: { hash: String(item.hash) } });
                    }
                    continue;
                }

                await prisma.intimacao.create({
                    data: {
                        djenId,
                        numeroProcesso: item.numeroprocessocommascara || item.numero_processo || null,
                        tribunal: item.siglaTribunal || null,
                        orgao: item.nomeOrgao || null,
                        tipoComunicacao: item.tipoComunicacao || null,
                        tipoDocumento: item.tipoDocumento || null,
                        nomeClasse: item.nomeClasse || null,
                        texto: item.texto || null,
                        link: item.link || null,
                        hash: item.hash ? String(item.hash) : null,
                        meio: item.meiocompleto || item.meio || null,
                        // data-only em meia-noite LOCAL (mesma regra dos prazos)
                        dataDisponibilizacao: item.data_disponibilizacao ? new Date(`${item.data_disponibilizacao}T00:00:00`) : null,
                        clienteExtraido: extrairCliente(item),
                        advogadoNome: extrairAdvogado(item),
                        oabConsulta: consulta.origem,
                    },
                });
                resultado.criadas++;
            }

            coletadas += items.length;
            pagina++;
            await sleep(800); // gentileza com a API entre páginas
        }

        resultado.oabs.push(consulta.rotulo);
    }

    logger.info(`[DJEN] sync concluído: ${resultado.criadas} novas, ${resultado.jaExistiam} já existiam (janela ${resultado.janela})`);
    return resultado;
}

// ── Heartbeat do sync ───────────────────────────────────────────────────────
// 26h: dá folga para o run das 06:30 de dias úteis sem falso-positivo, mas
// acusa um dia inteiro perdido.
const STALE_MS = 26 * 60 * 60 * 1000;

/** Regra de staleness — pura, mora só aqui. Sem sync bem-sucedido = stale. */
function isSyncStale(lastSuccessAt, now = new Date()) {
    if (!lastSuccessAt) return true;
    return now.getTime() - new Date(lastSuccessAt).getTime() > STALE_MS;
}

/**
 * Decide o que gravar a partir do resultado do sync — pura, testável sem banco.
 *
 * `djenLastSyncAt` (base da staleness) SÓ avança quando `erros` está vazio.
 * A API do DJEN não lança quando cai: `fetchPagina` desiste após 5 tentativas,
 * o erro vai para `resultado.erros` e a função retorna com `criadas: 0`. Se
 * carimbássemos esse caso, o painel diria "sincronizado agora" com o DJEN fora
 * do ar há dias, e o banner de stale nunca dispararia. Falha parcial (1 de N
 * OABs) também não carimba: aquelas intimações realmente não foram buscadas.
 */
function heartbeatPatch(resultado, now = new Date()) {
    const limpo = !resultado.erros || resultado.erros.length === 0;
    return {
        djenLastCriadas: resultado.criadas || 0,
        djenLastError: limpo ? null : resultado.erros.join(' · ').slice(0, 500),
        ...(limpo ? { djenLastSyncAt: now } : {}),
    };
}

/** Grava o heartbeat na linha única de SystemSettings. Nunca derruba o sync. */
async function recordHeartbeat(patch) {
    try {
        const row = await prisma.systemSettings.findFirst();
        if (row) await prisma.systemSettings.update({ where: { id: row.id }, data: patch });
        else await prisma.systemSettings.create({ data: patch });
    } catch (e) {
        logger.warn('[DJEN] falha ao gravar heartbeat:', e.message);
    }
}

/** Envolve o sync com o heartbeat. Os dois chamadores (cron e botão) passam por aqui. */
async function syncIntimacoes({ dias } = {}) {
    await recordHeartbeat({ djenLastAttemptAt: new Date() });
    try {
        const resultado = await executarSync({ dias });
        await recordHeartbeat(heartbeatPatch(resultado));
        return resultado;
    } catch (e) {
        await recordHeartbeat({ djenLastError: String(e?.message || e).slice(0, 500) });
        throw e;
    }
}

// ponytail: lock em memória, processo único. Se um dia rodar múltiplas
// instâncias, trocar por advisory lock no Postgres.
let _running = false;

/** Serializa o sync: cron e botão manual nunca rodam sobrepostos. */
async function syncIntimacoesSafe(opts = {}) {
    if (_running) return { skipped: true };
    _running = true;
    try {
        return await syncIntimacoes(opts);
    } finally {
        _running = false;
    }
}

module.exports = {
    syncIntimacoes, syncIntimacoesSafe, isSyncStale, heartbeatPatch,
    lerConfig, extrairCliente, extrairAdvogado, ehDoAdvogado,
};
