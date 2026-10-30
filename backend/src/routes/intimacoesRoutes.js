const logger = require('../infra/logger');
const express = require('express');
const router = express.Router();
const prisma = require('../infra/prismaClient');
const { syncIntimacoesSafe, isSyncStale } = require('../services/djenService');
const { gerarPrazosDoPje, soDigitos, melhorExpediente } = require('../services/pjePainel');
const { teorEmTexto } = require('../services/pjeLeitura');
const { parseBusca, buscaToWhere } = require('../services/buscaIntimacoes');

/**
 * Estado da última sincronização com o DJEN. `stale` é calculado no servidor
 * para a regra viver num lugar só (isSyncStale).
 */
async function syncStatusPayload() {
    const [s, leituras] = await Promise.all([
        prisma.systemSettings.findFirst(),
        // Último expediente visto por tribunal = última leitura que funcionou. O alerta diz
        // "sem ler há N dias" — "falhou na última busca" sozinho passou 5 dias sem ninguém notar.
        prisma.expedientePje.groupBy({ by: ['tribunal'], _max: { vistoEm: true } }),
    ]);
    const lastSuccessAt = s?.djenLastSyncAt || null;
    return {
        lastSuccessAt,
        lastAttemptAt: s?.djenLastAttemptAt || null,
        lastError: s?.djenLastError || null,
        criadas: s?.djenLastCriadas ?? 0,
        stale: isSyncStale(lastSuccessAt),
        pje: {
            lastAttemptAt: s?.pjeLastAttemptAt || null,
            lastBy: s?.pjeLastBy || null, // quem enviou a última leitura (robô do PC)
            // Mesma régua do DJEN (rodada da manhã do último dia útil): o robô parado num PC
            // desligado não manda falha nenhuma — só o atraso denuncia
            stale: isSyncStale(s?.pjeLastAttemptAt),
            falhas: s?.pjeLastFalhas || [],
            ultimaLeitura: Object.fromEntries(leituras.map((l) => [l.tribunal, l._max.vistoEm])),
        },
    };
}

// Liga cada intimação (DJEN) ao expediente do Painel do PJe (regra em pjePainel.melhorExpediente).
// É do expediente que vem a data limite oficial (calculada pelo PJe, não por nós).
async function anexarExpedientesPje(intimacoes) {
    const numeros = [...new Set(intimacoes.map((i) => soDigitos(i.numeroProcesso)).filter(Boolean))];
    if (!numeros.length) return intimacoes;
    const expedientes = await prisma.expedientePje.findMany({ where: { numeroProcesso: { in: numeros } } });
    const porProcesso = new Map();
    for (const e of expedientes) porProcesso.set(e.numeroProcesso, [...(porProcesso.get(e.numeroProcesso) || []), e]);
    return intimacoes.map((i) => ({
        ...i, expedientePje: melhorExpediente(i, porProcesso.get(soDigitos(i.numeroProcesso)) || []),
    }));
}

// GET /api/intimacoes — painel inicial: "recebidas hoje" e estado dos robôs.
// ?prazoId=<id>: as intimações de um card (teor e hash da certidão), para o modal do quadro.
// A caixa de intimações (lista do mês inteiro) saiu: tudo vira card, ela só repetia o quadro.
router.get('/', async (req, res) => {
    try {
        if (typeof req.query.prazoId === 'string') {
            const intimacoes = await prisma.intimacao.findMany({
                where: { prazoId: req.query.prazoId },
                orderBy: { dataDisponibilizacao: 'desc' },
                select: { id: true, tipoDocumento: true, tipoComunicacao: true, tribunal: true, orgao: true, texto: true, hash: true, link: true, dataDisponibilizacao: true },
            });
            return res.json({ success: true, intimacoes: intimacoes.map((i) => ({ ...i, texto: teorEmTexto(i.texto) })) });
        }
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const [recebidasHoje, syncStatus] = await Promise.all([
            prisma.intimacao.count({ where: { createdAt: { gte: hoje } } }),
            syncStatusPayload(),
        ]);
        res.json({ success: true, counts: { hoje: recebidasHoje }, syncStatus });
    } catch (error) {
        logger.error('[listIntimacoes] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao listar intimações.' });
    }
});

// GET /api/intimacoes/busca?q=tribunal:TJMT antes:2026-05-01 prazo&ordem=antigos&offset=0&limit=25
// Sintaxe estilo Discord (ver buscaIntimacoes.js). Paginado com total, como o total_results do Discord.
router.get('/busca', async (req, res) => {
    try {
        const where = buscaToWhere(parseBusca(req.query.q));
        const offset = Math.max(0, Math.trunc(Number(req.query.offset)) || 0);
        const limit = Math.min(100, Math.max(1, Math.trunc(Number(req.query.limit)) || 25));
        const [intimacoes, total] = await Promise.all([
            prisma.intimacao.findMany({
                where,
                orderBy: { dataDisponibilizacao: req.query.ordem === 'antigos' ? 'asc' : 'desc' },
                skip: offset,
                take: limit,
                include: { prazo: { select: { id: true, title: true, status: true, fatalDate: true, caseReference: true } } },
            }),
            prisma.intimacao.count({ where }),
        ]);
        res.json({ success: true, total, offset, limit, intimacoes: await anexarExpedientesPje(intimacoes) });
    } catch (error) {
        logger.error('[buscaIntimacoes] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar intimações.' });
    }
});

// POST /api/intimacoes/sync — busca novas comunicações no DJEN ({ dias } opcional)
router.post('/sync', async (req, res) => {
    try {
        // Teto de 30 dias: cada dia a mais é mais página na API do DJEN.
        const dias = req.body?.dias ? Math.min(30, Math.max(1, Math.trunc(Number(req.body.dias)) || 1)) : undefined;
        const resultado = await syncIntimacoesSafe({ dias });
        // O cron pode estar rodando: não enfileira, avisa (o front já mostra o toast de erro).
        if (resultado.skipped) {
            return res.status(409).json({ success: false, error: 'Sincronização já em andamento. Tente em instantes.' });
        }
        // Intimação nova vira card na hora: liga ao PJe se houver; senão "a confirmar"
        const quadro = await gerarPrazosDoPje();
        res.json({ success: true, ...resultado, quadro });
    } catch (error) {
        logger.error('[syncIntimacoes] Erro:', error);
        // O que o sync gravou antes de quebrar vira card mesmo assim
        await gerarPrazosDoPje().catch(() => {});
        res.status(500).json({ success: false, error: 'Erro ao buscar intimações no DJEN.' });
    }
});

// O PJe não é lido pelo servidor: ver pjeLeituraRoutes (vez + leitura enviada pelo robô do PC).

module.exports = router;
