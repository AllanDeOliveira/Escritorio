const logger = require('../infra/logger');
const express = require('express');
const prisma = require('../infra/prismaClient');
const router = express.Router();

// GET /api/pieces
router.get('/', async (req, res) => {
    try {
        const petitions = await prisma.petition.findMany({
            include: { lawsuit: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, petitions });
    } catch (error) {
        logger.error('Erro ao buscar petições:', error);
        res.status(500).json({ success: false, error: 'Falha ao buscar as petições criadas.' });
    }
});

// POST /api/pieces
router.post('/', async (req, res) => {
    try {
        const { title, content, lawsuitId, status } = req.body;
        if (!title || !content || !lawsuitId) {
            return res.status(400).json({ success: false, error: 'Título, Conteúdo e Processo vinculados são obrigatórios.' });
        }

        const petition = await prisma.petition.create({
            data: {
                title,
                content,
                lawsuitId,
                status: status || 'RASCUNHO'
            }
        });
        res.json({ success: true, petition });
    } catch (error) {
        logger.error('Erro ao salvar petição:', error);
        res.status(500).json({ success: false, error: 'Falha ao gravar a petição no banco.' });
    }
});

// PUT /api/pieces/:id/status
router.put('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const updated = await prisma.petition.update({
            where: { id },
            data: { status }
        });
        res.json({ success: true, petition: updated });
    } catch (error) {
        logger.error('Erro ao atualizar status:', error);
        res.status(500).json({ success: false, error: 'Falha atualizar status.' });
    }
});

module.exports = router;
