const logger = require('../infra/logger');
const express = require('express');
const router = express.Router();
const prisma = require('../infra/prismaClient');
const { syncIntimacoesSafe, isSyncStale } = require('../services/djenService');
const { syncExpedientesPje, soDigitos, melhorExpediente } = require('../services/pjePainel');

const INT_STATUS = ['NOVA', 'GERADA', 'DESCARTADA'];

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
    };
}

// Meia-noite local de "YYYY-MM-DD" (mesma regra do prazosRoutes)
function parseDateOnly(value) {
    if (!value) return undefined;
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(value);
}

// Liga cada intimação (DJEN) ao expediente do Painel do PJe (regra em pjePainel.melhorExpediente).
// É do expediente que vem a data limite oficial (calculada pelo PJe, não por nós).
async function anexarExpedientesPje(intimacoes) {
    const numeros = [...new Set(intimacoes.map((i) => soDigitos(i.numeroProcesso)).filter(Boolean))];
    if (!numeros.length) return intimacoes;
    const expedientes = await prisma.expedientePje.findMany({ where: { numeroProcesso: { in: numeros } } });
    const porProcesso = new Map();
    for (const e of expedientes) porProcesso.set(e.numeroProcesso, [...(porProcesso.get(e.numeroProcesso) || []), e]);
    // Prazos do robô que ainda existem no quadro (o prazoId fica no expediente mesmo após exclusão)
    const prazos = await prisma.prazo.findMany({
        where: { id: { in: expedientes.map((e) => e.prazoId).filter(Boolean) } },
        select: { id: true, fatalDate: true, status: true },
    });
    const prazoPorId = new Map(prazos.map((p) => [p.id, p]));
    return intimacoes.map((i) => {
        const candidatos = porProcesso.get(soDigitos(i.numeroProcesso)) || [];
        // Aviso de possível duplicidade: o processo já tem prazo do PJe no quadro
        const noQuadro = candidatos.map((e) => prazoPorId.get(e.prazoId)).filter(Boolean);
        const prazoPjeProcesso = noQuadro.length
            ? { total: noQuadro.length, proximoLimite: noQuadro.map((p) => p.fatalDate).sort((a, b) => a - b)[0] }
            : null;
        return { ...i, expedientePje: melhorExpediente(i, candidatos), prazoPjeProcesso };
    });
}

function nomeRevisor(req) {
    return req.currentUser?.name || req.currentUser?.email || 'desconhecido';
}

// A fila de uma área é compartilhada: quando a intimação já saiu de NOVA, outra
// pessoa chegou antes. 409 com o nome dela; 404 se o id nem existe.
async function jaTratada(res, id) {
    const i = await prisma.intimacao.findUnique({ where: { id }, select: { revisadoPor: true } });
    if (!i) return res.status(404).json({ success: false, error: 'Intimação não encontrada.' });
    return res.status(409).json({ success: false, error: `Esta intimação já foi tratada por ${i.revisadoPor || 'outra pessoa'}.` });
}

// GET /api/intimacoes?status=NOVA — lista + contadores
// Contadores por ATO único = (processo + data + texto). O DJEN publica a mesma
// comunicação uma vez por destinatário, e o front agrupa essas cópias. Agrupar
// só por texto colaria processos distintos que compartilham teor genérico
// (ex.: "Intimação das partes acerca da expedição do alvará"), então a chave
// inclui numeroProcesso e dataDisponibilizacao.
const CHAVE_ATO = ['numeroProcesso', 'dataDisponibilizacao', 'texto'];
router.get('/', async (req, res) => {
    try {
        const status = INT_STATUS.includes(req.query.status) ? req.query.status : 'NOVA';
        // ?mes=YYYY-MM restringe pela data de disponibilização (mês local).
        // Contadores seguem o mesmo recorte para os badges baterem com a lista.
        let porMes = {};
        const mes = String(req.query.mes || '');
        const mMes = mes.match(/^(\d{4})-(\d{2})$/);
        if (mMes) {
            const ano = Number(mMes[1]);
            const mesIdx = Number(mMes[2]) - 1;
            porMes = { dataDisponibilizacao: { gte: new Date(ano, mesIdx, 1), lt: new Date(ano, mesIdx + 1, 1) } };
        }
        const [intimacoes, novaG, geradaG, descartadaG, syncStatus] = await Promise.all([
            prisma.intimacao.findMany({
                where: { status, ...porMes },
                orderBy: { dataDisponibilizacao: 'desc' },
                // Prazo vinculado: permite concluir/acompanhar direto da aba "Viraram prazo"
                include: { prazo: { select: { id: true, title: true, status: true, fatalDate: true, caseReference: true } } },
            }),
            prisma.intimacao.groupBy({ by: CHAVE_ATO, where: { status: 'NOVA', ...porMes } }),
            prisma.intimacao.groupBy({ by: CHAVE_ATO, where: { status: 'GERADA', ...porMes } }),
            prisma.intimacao.groupBy({ by: CHAVE_ATO, where: { status: 'DESCARTADA', ...porMes } }),
            syncStatusPayload(),
        ]);
        res.json({
            success: true,
            intimacoes: await anexarExpedientesPje(intimacoes),
            counts: { nova: novaG.length, gerada: geradaG.length, descartada: descartadaG.length },
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
        const dias = req.body?.dias ? Number(req.body.dias) : undefined;
        const resultado = await syncIntimacoesSafe({ dias });
        // O cron pode estar rodando: não enfileira, avisa (o front já mostra o toast de erro).
        if (resultado.skipped) {
            return res.status(409).json({ success: false, error: 'Sincronização já em andamento. Tente em instantes.' });
        }
        res.json({ success: true, ...resultado });
    } catch (error) {
        logger.error('[syncIntimacoes] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar intimações no DJEN.' });
    }
});

// POST /api/intimacoes/sync-pje — lê o Painel do Advogado (certificado A1) e
// atualiza prazos/datas limite oficiais. Só leitura no PJe (ver pjePainel.js).
router.post('/sync-pje', async (_req, res) => {
    try {
        const r = await syncExpedientesPje();
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

// POST /api/intimacoes/:id/gerar-prazo — revisão confirmada: intimação vira card
router.post('/:id/gerar-prazo', async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body || {};

        const errors = [];
        if (!body.title || !String(body.title).trim()) errors.push('title é obrigatório');
        if (!body.fatalDate || isNaN(Date.parse(body.fatalDate))) errors.push('fatalDate é obrigatória e deve ser válida');
        if (errors.length) return res.status(400).json({ success: false, error: 'Dados inválidos', details: errors });

        // Sem responsável escolhido, o prazo fica com quem fez a triagem
        const responsibleId = body.responsibleId ? String(body.responsibleId) : req.currentUser?.id || null;
        if (body.responsibleId && !(await prisma.user.findUnique({ where: { id: responsibleId } }))) {
            return res.status(400).json({ success: false, error: 'Responsável não encontrado.' });
        }

        const grupoIds = Array.isArray(body.grupoIds) ? body.grupoIds.filter((x) => typeof x === 'string') : [];
        const revisao = { revisadoPor: nomeRevisor(req), revisadoEm: new Date() };

        // Reivindica o ato ANTES de criar o prazo: o UPDATE condicional trava a linha,
        // então cliques simultâneos da mesma fila esperam e caem em count 0 → 409.
        const prazo = await prisma.$transaction(async (tx) => {
            const claim = await tx.intimacao.updateMany({ where: { id, status: 'NOVA' }, data: { status: 'GERADA', ...revisao } });
            if (claim.count === 0) return null;
            const intimacao = await tx.intimacao.findUnique({ where: { id }, select: { numeroProcesso: true } });
            const criado = await tx.prazo.create({
                data: {
                    title: String(body.title).trim(),
                    caseReference: (body.caseReference && String(body.caseReference).trim()) || intimacao.numeroProcesso || null,
                    responsibleName: (body.responsibleName && String(body.responsibleName).trim()) || null,
                    responsibleId,
                    type: body.type || 'JUDICIAL',
                    fatalDate: parseDateOnly(body.fatalDate),
                    internalDate: body.internalDate ? parseDateOnly(body.internalDate) : undefined,
                    description: (body.description && String(body.description).trim()) || null,
                    createdById: req.currentUser?.id || undefined,
                },
            });
            // Marca também as cópias do mesmo ato (grupoIds vindas do front)
            await tx.intimacao.updateMany({
                where: { id: { in: [id, ...grupoIds] } },
                data: { status: 'GERADA', prazoId: criado.id, ...revisao },
            });
            return criado;
        });
        if (!prazo) return jaTratada(res, id);

        res.status(201).json({ success: true, prazo });
    } catch (error) {
        logger.error('[gerarPrazoDeIntimacao] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao gerar prazo a partir da intimação.' });
    }
});

// POST /api/intimacoes/:id/descartar — não é prazo (pauta, sem prazo, etc.)
// Aceita grupoIds para descartar junto as cópias do mesmo ato.
router.post('/:id/descartar', async (req, res) => {
    try {
        const { id } = req.params;
        const grupoIds = Array.isArray(req.body?.grupoIds) ? req.body.grupoIds.filter((x) => typeof x === 'string') : [];
        // Só descarta o que ainda está NOVA: com tela desatualizada, não pode
        // descartar um ato que outra pessoa já transformou em prazo.
        const r = await prisma.intimacao.updateMany({
            where: { id: { in: [id, ...grupoIds] }, status: 'NOVA' },
            data: { status: 'DESCARTADA', revisadoPor: nomeRevisor(req), revisadoEm: new Date() },
        });
        if (r.count === 0) return jaTratada(res, id);
        res.json({ success: true, atualizadas: r.count });
    } catch (error) {
        logger.error('[descartarIntimacao] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao descartar intimação.' });
    }
});

// POST /api/intimacoes/:id/restaurar — desfaz um descarte acidental (grupo junto).
// Também reabre intimações GERADAS cujo prazo vinculado foi excluído do quadro
// (o delete do prazo anula o prazoId via SetNull, deixando o card órfão).
router.post('/:id/restaurar', async (req, res) => {
    try {
        const { id } = req.params;
        const grupoIds = Array.isArray(req.body?.grupoIds) ? req.body.grupoIds.filter((x) => typeof x === 'string') : [];
        const r = await prisma.intimacao.updateMany({
            where: {
                id: { in: [id, ...grupoIds] },
                OR: [{ status: 'DESCARTADA' }, { status: 'GERADA', prazoId: null }],
            },
            data: { status: 'NOVA', prazoId: null, revisadoPor: null, revisadoEm: null },
        });
        if (r.count === 0) return res.status(404).json({ success: false, error: 'Nenhuma intimação encontrada para restaurar.' });
        res.json({ success: true, atualizadas: r.count });
    } catch (error) {
        logger.error('[restaurarIntimacao] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao restaurar intimação.' });
    }
});

module.exports = router;
