const prisma = require('../infra/prismaClient');
const logger = require('../infra/logger');
const auth = require('../infra/auth');

/**
 * Exige ID token válido do Firebase (conta @jvo.adv.br) e um User cadastrado
 * com esse e-mail. Qualquer membro passa; para admin, ver requireAdmin.
 */
async function requireUser(req, res, next) {
    try {
        const r = await auth.emailDoToken(req);
        if (r.error) return res.status(r.status).json({ success: false, error: r.error });

        const user = await prisma.user.findUnique({ where: { email: r.email } });
        if (!user) {
            return res.status(403).json({ success: false, error: 'Usuário não reconhecido' });
        }

        req.currentUser = user;
        next();
    } catch (err) {
        logger.error('Erro ao verificar usuário:', err);
        return res.status(500).json({ success: false, error: 'Erro interno ao verificar usuário' });
    }
}

module.exports = { requireUser };
