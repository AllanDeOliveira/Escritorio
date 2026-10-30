const logger = require('../infra/logger');
const auth = require('../infra/auth');
const { requireUser } = require('./requireUser');

/**
 * Rotas do robô do PJe: aceita o token do robô (Authorization: Bearer, gerado na aba Perfil)
 * OU a sessão normal (cookie). O token não vale em nenhuma outra rota: requireUser só olha o cookie.
 */
async function requireRoboOuUsuario(req, res, next) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return requireUser(req, res, next);
    try {
        const user = await auth.usuarioDoTokenRobo(m[1]);
        if (!user) return res.status(401).json({ success: false, error: 'Token do robô inválido ou revogado. Gere outro na aba Perfil do Central.' });
        req.currentUser = user;
        next();
    } catch (err) {
        logger.error('Erro ao verificar token do robô:', err);
        return res.status(500).json({ success: false, error: 'Erro interno ao verificar o token do robô' });
    }
}

module.exports = { requireRoboOuUsuario };
