const logger = require('../infra/logger');
const express = require('express');
const router = express.Router();
const { consultarAvisosPendentes, statusConfig } = require('../services/mniService');

// GET /api/mni/status — a integração está configurada? (sem chamar o tribunal)
router.get('/status', (_req, res) => {
    res.json({ success: true, ...statusConfig() });
});

// GET /api/mni/avisos — lista expedientes pendentes de ciência no PJe/TJMT.
// Operação de LEITURA: não efetiva ciência (ver guarda em mniService.js).
router.get('/avisos', async (_req, res) => {
    try {
        const r = await consultarAvisosPendentes();
        if (!r.configurado) {
            return res.json({ success: false, configurado: false, faltando: r.faltando });
        }
        res.json({
            success: r.sucesso,
            configurado: true,
            mensagem: r.mensagem,
            total: r.avisos.length,
            avisos: r.avisos,
            consultadoEm: r.consultadoEm,
        });
    } catch (error) {
        logger.error('[mniAvisos] Erro:', error);
        res.status(502).json({ success: false, error: `Falha ao consultar o MNI: ${error.message}` });
    }
});

module.exports = router;
