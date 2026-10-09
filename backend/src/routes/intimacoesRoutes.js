const logger = require('../infra/logger');
const express = require('express');
const router = express.Router();
const prisma = require('../infra/prismaClient');
const { syncIntimacoesSafe, isSyncStale } = require('../services/djenService');
const { syncExpedientesPje, gerarPrazosDoPje, soDigitos, melhorExpediente } = require('../services/pjePainel');

/**
 * Estado da última sincronização com o DJEN. `stale` é calculado no servidor
 * para a regra viver num lugar só (isSyncStale).
 */
async function syncStatusPayload() {
    const s = await prisma.systemSettings.findFirst();
    const lastSuccessAt = s?.djenLastSyncAt || null;
    return {
        lastSuccessAt,
        lastAttemptAt: s?.djenLastAttemptAt || null,
        lastError: s?.djenLastError || null,
        criadas: s?.djenLastCriadas ?? 0,
        stale: isSyncStale(lastSuccessAt),
        pje: { lastAttemptAt: s?.pjeLastAttemptAt || null, falhas: s?.pjeLastFalhas || [] },
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

// GET /api/intimacoes?mes=YYYY-MM — tudo que chegou (cada intimação já tem card no quadro).
// ?resumo=1: só contadores e estado do sync, para o painel inicial (sem a lista pesada).
router.get('/', async (req, res) => {
    try {
        // ?mes=YYYY-MM restringe pela data de disponibilização (mês local).
        let porMes = {};
        const mes = String(req.query.mes || '');
        const mMes = mes.match(/^(\d{4})-(\d{2})$/);
        if (mMes) {
            const ano = Number(mMes[1]);
            const mesIdx = Number(mMes[2]) - 1;
            porMes = { dataDisponibilizacao: { gte: new Date(ano, mesIdx, 1), lt: new Date(ano, mesIdx + 1, 1) } };
        }
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const [intimacoes, recebidasHoje, syncStatus] = await Promise.all([
            req.query.resumo ? [] : prisma.intimacao.findMany({
                where: porMes,
                orderBy: { dataDisponibilizacao: 'desc' },
                // Card vinculado: permite concluir/acompanhar direto da caixa
                include: { prazo: { select: { id: true, title: true, status: true, fatalDate: true, caseReference: true } } },
            }),
            // Painel inicial: "recebidas hoje"
            prisma.intimacao.count({ where: { createdAt: { gte: hoje } } }),
            syncStatusPayload(),
        ]);
        res.json({
            success: true,
            intimacoes: await anexarExpedientesPje(intimacoes),
            counts: { hoje: recebidasHoje },
            syncStatus,
        });
    } catch (error) {
        logger.error('[listIntimacoes] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao listar intimações.' });
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

// POST /api/intimacoes/sync-pje — lê o Painel do Advogado (certificado A1) e
// atualiza prazos/datas limite oficiais. Só leitura no PJe (ver pjePainel.js).
// Login com certificado A1 + 2FA do advogado: logins em sequência podem bloquear a
// conta no tribunal. O cron já roda às 06:40 e 12:40; manual, no máximo 1 a cada 10 min.
const PJE_INTERVALO_MS = 10 * 60 * 1000;
let pjeUltimaManual = 0;

router.post('/sync-pje', async (_req, res) => {
    try {
        const espera = pjeUltimaManual + PJE_INTERVALO_MS - Date.now();
        if (espera > 0) {
            return res.status(429).json({ success: false, error: `O PJe foi consultado há pouco. Tente de novo em ${Math.ceil(espera / 60000)} min.` });
        }
        const r = await syncExpedientesPje();
        if (!r.skipped) pjeUltimaManual = Date.now();
        if (r.skipped) {
            const error = r.motivo === 'já em andamento'
                ? 'Alguém já está buscando os prazos no PJe. Aguarde uns 2 minutos e recarregue a caixa.'
                : `PJe não sincronizado: ${r.motivo}`;
            return res.status(409).json({ success: false, error });
        }
        res.json({ success: true, resultado: r.resultado, prazos: r.prazos });
    } catch (error) {
        logger.error('[syncPje] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao ler o Painel do PJe.' });
    }
});

module.exports = router;
