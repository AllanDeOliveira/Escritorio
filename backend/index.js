// .env é carregado via --env-file-if-exists=.env nos scripts do package.json
const express = require('express');
const cors = require('cors');
const { lerConfig, salvarConfig } = require('./src/config/escritorioConfig');
const prisma = require('./src/infra/prismaClient');
const logger = require('./src/infra/logger');

// Auth imports
const userRoutes = require('./src/routes/userRoutes');
const { requireAdmin } = require('./src/middleware/requireAdmin');
const { requireUser } = require('./src/middleware/requireUser');

const cron = require('node-cron');
const { syncIntimacoesSafe } = require('./src/services/djenService');
const { syncExpedientesPje } = require('./src/services/pjePainel');

const app = express();
const allowedOrigins = process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL]
    : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
// Express 5 deixa req.body undefined sem corpo JSON; as rotas leem body.campo direto
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });

// Auth routes
app.use('/api/users', userRoutes);
app.use('/api/admin', requireAdmin);

// ═══════════════════════════════════════════════════════════════════════════
// ROTAS — CONFIGURAÇÕES DO ESCRITÓRIO
// ═══════════════════════════════════════════════════════════════════════════

// Sem requireUser propositalmente: chamada antes do login (tela de login
// mostra o nome do sistema). Só expõe dados de marca do escritório, não sensíveis.
app.get('/api/config', (req, res) => {
    res.json({ success: true, config: lerConfig() });
});

// Salvar configurações
app.post('/api/config', requireAdmin, (req, res) => {
    try {
        salvarConfig(req.body);
        res.json({ success: true });
    } catch (err) {
        logger.error(`${req.method} ${req.path}:`, err);
        res.status(500).json({ success: false, error: 'Erro interno.' });
    }
});


// ═══════════════════════════════════════════════════════════════════════════
// ROTA DO PAINEL DE ADMINISTRADOR
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/admin/stats', async (req, res) => {
    try {
        const users = await prisma.user.count();
        res.json({ success: true, stats: { users } });
    } catch (e) {
        logger.error(`${req.method} ${req.path}:`, e);
        res.status(500).json({ success: false, error: 'Erro interno.' });
    }
});


// Registar rotas
const prazosRoutes = require('./src/routes/prazosRoutes');
app.use('/api/prazos', requireUser, prazosRoutes);
const intimacoesRoutes = require('./src/routes/intimacoesRoutes');
app.use('/api/intimacoes', requireUser, intimacoesRoutes);
const mniRoutes = require('./src/routes/mniRoutes');
app.use('/api/mni', requireUser, mniRoutes);

// Handler final: JSON malformado, corpo grande demais etc. Sem stack trace na
// resposta (o padrão do Express mostra quando NODE_ENV não é 'production').
app.use((err, req, res, _next) => {
    // Upload recusado pelo multer (planilha grande demais, campo errado) é erro do cliente, não 500
    if (err.name === 'MulterError') {
        const grande = err.code === 'LIMIT_FILE_SIZE';
        return res.status(grande ? 413 : 400).json({ success: false, error: grande ? 'Planilha acima de 5 MB.' : 'Envio inválido.' });
    }
    const status = err.status || err.statusCode || 500;
    if (status >= 500) logger.error(`${req.method} ${req.path}:`, err);
    res.status(status).json({ success: false, error: err.expose ? err.message : 'Erro interno.' });
});

const PORT = process.env.PORT || 3001;
// Express 5 chama este callback também quando o listen FALHA (ex.: porta em uso),
// passando o erro. Sem esta checagem o log dizia "rodando" e o processo saía mudo.
app.listen(PORT, (err) => {
    if (err) {
        logger.error(err.code === 'EADDRINUSE'
            ? `Porta ${PORT} já está em uso — outro backend ainda está rodando? Encerre-o e inicie de novo.`
            : `Falha ao abrir a porta ${PORT}:`, err);
        process.exit(1);
    }
    logger.info(`Backend Central JVO rodando na porta ${PORT}`);

    // Sincronização automática do DJEN — dias úteis, 06:30 em Cuiabá.
    // Timezone explícito porque o Render roda em UTC e a OAB é MT (UTC-4): sem
    // isso, '30 6' dispararia 02:30 local e o rótulo "sincronizado às 06:30" mentiria.
    if (process.env.DISABLE_DJEN_CRON === 'true') {
        logger.info('Cron do DJEN desativado (DISABLE_DJEN_CRON=true).');
    } else {
        cron.schedule('30 6 * * 1-5', async () => {
            logger.info('[DJEN cron] Iniciando sincronização automática...');
            try {
                const r = await syncIntimacoesSafe();
                if (r.skipped) logger.warn('[DJEN cron] Pulado: já havia uma sincronização em andamento.');
                else logger.info(`[DJEN cron] ${r.criadas} nova(s) intimação(ões) (janela ${r.janela}).`);
            } catch (e) {
                // O servidor nunca cai por causa do sync; o heartbeat marca a falha.
                logger.error('[DJEN cron] Falhou:', e);
            }
        }, { timezone: 'America/Cuiaba' });
        logger.info('Cron do DJEN agendado: 06:30, dias úteis (America/Cuiaba).');
    }

    // Painel do Advogado do PJe (prazos e datas limite oficiais) — só onde o
    // certificado A1 + chave TOTP estão configurados; sem eles o sync se recusa sozinho.
    if (process.env.DISABLE_PJE_CRON === 'true') {
        logger.info('Cron do PJe desativado (DISABLE_PJE_CRON=true).');
    } else {
        cron.schedule('40 6,12 * * 1-5', async () => {
            try {
                const r = await syncExpedientesPje();
                if (r.skipped) logger.warn(`[PJe cron] Pulado: ${r.motivo}`);
                else logger.info(`[PJe cron] ${JSON.stringify(r.resultado)}`);
            } catch (e) {
                logger.error('[PJe cron] Falhou:', e);
            }
        }, { timezone: 'America/Cuiaba' });
        logger.info('Cron do PJe agendado: 06:40 e 12:40, dias úteis (America/Cuiaba).');
    }

});

// ── Tratamento de Fechamento (Evitar EPERM no Prisma) ───────────────────────
const gracefulShutdown = async (signal) => {
    logger.info(`\nRecebido ${signal}. Encerrando Central JVO de forma limpa...`);
    try {
        if (prisma) {
            await prisma.$disconnect();
            logger.info('Conexão com Banco de Dados encerrada.');
        }
    } catch (e) {
        logger.error('Erro no encerramento limpo:', e);
    }
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
// Depois de um erro fatal o processo fica em estado incerto: loga e sai. Quem religa é o
// concurrently do Iniciar_App.bat (--restart-tries); o node --watch sozinho NÃO religa após crash.
process.on('uncaughtException', (err) => {
    logger.error('Erro não tratado — encerrando:', err);
    process.exit(1);
});
