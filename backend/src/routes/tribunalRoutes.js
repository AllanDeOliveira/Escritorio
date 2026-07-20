const logger = require('../infra/logger');
const express = require('express');
const { getProcesso } = require('../services/tribunalService.js');
const prisma = require('../infra/prismaClient');

const router = express.Router();

// GET /api/processos - Retorna todos os processos monitorados salvos no banco
router.get('/', async (req, res) => {
    try {
        const processos = await prisma.lawsuit.findMany({
            orderBy: { updatedAt: 'desc' }
        });
        res.json({ success: true, processos });
    } catch (error) {
        logger.error('Erro ao buscar processos salvos:', error);
        res.status(500).json({ success: false, error: 'Falha ao buscar processos.' });
    }
});

// POST /api/processos/salvar - Salva a consulta para rastreamento
router.post('/salvar', async (req, res) => {
    try {
        const { numero, tribunal, classe, assunto, status } = req.body;
        
        if (!numero) throw new Error("Número do processo é obrigatório.");

        const lawsuit = await prisma.lawsuit.upsert({
            where: { caseNumber: numero },
            update: {
                court: tribunal,
                actionType: classe,
                status: status || "ATIVO"
                // notes: assunto
            },
            create: {
                caseNumber: numero,
                court: tribunal,
                actionType: classe,
                status: status || "ATIVO"
            }
        });

        res.json({ success: true, message: 'Processo salvo para monitoramento!', lawsuit });
    } catch (error) {
        logger.error('Erro ao salvar processo:', error);
        res.status(400).json({ success: false, error: 'Falha ao salvar no banco.' });
    }
});

// GET /api/processos/:numero - Consulta informações e andamentos
router.get('/:numero', async (req, res) => {
    const { numero } = req.params;

    try {
        const dados = await getProcesso(numero);
        res.json({ success: true, ...dados });
    } catch (error) {
        logger.error(`Erro ao consultar processo ${numero}:`, error);
        res.status(400).json({ success: false, error: error.message });
    }
});

module.exports = router;
