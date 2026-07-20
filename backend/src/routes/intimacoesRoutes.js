const logger = require('../infra/logger');
const express = require('express');
const router = express.Router();
const prisma = require('../infra/prismaClient');
const { syncIntimacoes } = require('../services/djenService');

const INT_STATUS = ['NOVA', 'GERADA', 'DESCARTADA'];

// Meia-noite local de "YYYY-MM-DD" (mesma regra do prazosRoutes)
function parseDateOnly(value) {
    if (!value) return undefined;
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(value);
}

function nomeRevisor(req) {
    return req.currentUser?.name || req.currentUser?.email || 'desconhecido';
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
        const [intimacoes, novaG, geradaG, descartadaG] = await Promise.all([
            prisma.intimacao.findMany({
                where: { status, ...porMes },
                orderBy: { dataDisponibilizacao: 'desc' },
                // Prazo vinculado: permite concluir/acompanhar direto da aba "Viraram prazo"
                include: { prazo: { select: { id: true, title: true, status: true, fatalDate: true, caseReference: true } } },
            }),
            prisma.intimacao.groupBy({ by: CHAVE_ATO, where: { status: 'NOVA', ...porMes } }),
            prisma.intimacao.groupBy({ by: CHAVE_ATO, where: { status: 'GERADA', ...porMes } }),
            prisma.intimacao.groupBy({ by: CHAVE_ATO, where: { status: 'DESCARTADA', ...porMes } }),
        ]);
        res.json({
            success: true,
            intimacoes,
            counts: { nova: novaG.length, gerada: geradaG.length, descartada: descartadaG.length },
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
        const resultado = await syncIntimacoes({ dias });
        res.json({ success: true, ...resultado });
    } catch (error) {
        logger.error('[syncIntimacoes] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar intimações no DJEN.' });
    }
});

// POST /api/intimacoes/:id/gerar-prazo — revisão confirmada: intimação vira card
router.post('/:id/gerar-prazo', async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body || {};

        const intimacao = await prisma.intimacao.findUnique({ where: { id } });
        if (!intimacao) return res.status(404).json({ success: false, error: 'Intimação não encontrada.' });
        if (intimacao.status === 'GERADA') return res.status(400).json({ success: false, error: 'Esta intimação já gerou um prazo.' });

        const errors = [];
        if (!body.title || !String(body.title).trim()) errors.push('title é obrigatório');
        if (!body.fatalDate || isNaN(Date.parse(body.fatalDate))) errors.push('fatalDate é obrigatória e deve ser válida');
        if (errors.length) return res.status(400).json({ success: false, error: 'Dados inválidos', details: errors });

        const prazo = await prisma.prazo.create({
            data: {
                title: String(body.title).trim(),
                caseReference: (body.caseReference && String(body.caseReference).trim()) || intimacao.numeroProcesso || null,
                responsibleName: (body.responsibleName && String(body.responsibleName).trim()) || null,
                type: body.type || 'JUDICIAL',
                fatalDate: parseDateOnly(body.fatalDate),
                internalDate: body.internalDate ? parseDateOnly(body.internalDate) : undefined,
                description: (body.description && String(body.description).trim()) || null,
                createdById: req.currentUser?.id || undefined,
            },
        });

        // Marca também as cópias do mesmo ato (grupoIds vindas do front)
        const grupoIds = Array.isArray(body.grupoIds) ? body.grupoIds.filter((x) => typeof x === 'string') : [];
        await prisma.intimacao.updateMany({
            where: { id: { in: [id, ...grupoIds] } },
            data: { status: 'GERADA', prazoId: prazo.id, revisadoPor: nomeRevisor(req), revisadoEm: new Date() },
        });

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
        const r = await prisma.intimacao.updateMany({
            where: { id: { in: [id, ...grupoIds] } },
            data: { status: 'DESCARTADA', revisadoPor: nomeRevisor(req), revisadoEm: new Date() },
        });
        if (r.count === 0) return res.status(404).json({ success: false, error: 'Intimação não encontrada.' });
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
