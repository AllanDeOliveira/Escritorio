const logger = require('../infra/logger');
const express = require('express');
const router = express.Router();
const { consultarAvisosPendentes, statusConfig } = require('../services/mniService');

// GET /api/mni/status — a integração está configurada? (sem chamar o tribunal)
router.get('/status', (_req, res) => {
    res.json({ success: true, ...statusConfig() });
});

// Cada consulta faz login com o certificado A1 do advogado: a caixa abre em
// vários navegadores ao mesmo tempo, então a mesma resposta vale por 5 min.
const CACHE_MS = 5 * 60 * 1000;
let cache = null;

// GET /api/mni/avisos — lista expedientes pendentes de ciência no PJe/TJMT.
// Operação de LEITURA: não efetiva ciência (ver guarda em mniService.js).
router.get('/avisos', async (_req, res) => {
    try {
        if (cache && Date.now() - cache.em < CACHE_MS) return res.json(cache.body);
        const r = await consultarAvisosPendentes();
        if (!r.configurado) {
            return res.json({ success: false, configurado: false, faltando: r.faltando });
        }
        const body = {
            success: r.sucesso,
            configurado: true,
            mensagem: r.mensagem,
            total: r.avisos.length,
            avisos: r.avisos,
            consultadoEm: r.consultadoEm,
        };
        if (r.sucesso) cache = { em: Date.now(), body };
        res.json(body);
    } catch (error) {
        logger.error('[mniAvisos] Erro:', error);
        res.status(502).json({ success: false, error: 'Falha ao consultar o MNI.' });
    }
});

module.exports = router;
