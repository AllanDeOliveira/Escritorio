const prisma = require('../infra/prismaClient');
const logger = require('../infra/logger');
const auth = require('../infra/auth');

/** Como requireUser (ID token do Firebase verificado), mas exige role === 'admin'. */
async function requireAdmin(req, res, next) {
    try {
        const r = await auth.emailDoToken(req);
        if (r.error) return res.status(r.status).json({ success: false, error: r.error });

        const user = await prisma.user.findUnique({ where: { email: r.email } });

        if (!user || user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Acesso restrito a administradores' });
        }

        req.adminUser = user;
        req.currentUser = user;
        next();
    } catch (err) {
        logger.error('Erro ao verificar permissão de admin:', err);
        return res.status(500).json({ success: false, error: 'Erro interno ao verificar permissão' });
    }
}

module.exports = { requireAdmin };
