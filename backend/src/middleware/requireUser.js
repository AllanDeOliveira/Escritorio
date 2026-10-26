const logger = require('../infra/logger');
const auth = require('../infra/auth');

/**
 * Exige sessão válida (cookie httpOnly do login) de um usuário ativo.
 * Qualquer membro passa; para admin, ver requireAdmin.
 */
async function requireUser(req, res, next) {
    try {
        const user = await auth.usuarioDaSessao(auth.lerCookie(req));
        if (!user) return res.status(401).json({ success: false, error: 'Sessão expirada. Entre de novo.' });
        req.currentUser = user;
        next();
    } catch (err) {
        logger.error('Erro ao verificar usuário:', err);
        return res.status(500).json({ success: false, error: 'Erro interno ao verificar usuário' });
    }
}

module.exports = { requireUser };
