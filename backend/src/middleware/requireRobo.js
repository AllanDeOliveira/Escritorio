const logger = require('../infra/logger');
const auth = require('../infra/auth');

/**
 * Rotas do robô do PJe: só o token do robô (Authorization: Bearer, gerado na aba Perfil), e só de
 * quem o admin liberou (podeRodarRobo). A sessão do navegador não vale aqui: uma leitura dá baixa
 * em prazos, então não pode vir de qualquer membro. O token não vale em nenhuma outra rota.
 */
async function requireRobo(req, res, next) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ success: false, error: 'Token do robô ausente.' });
    try {
        const user = await auth.usuarioDoTokenRobo(m[1]);
        if (!user) return res.status(401).json({ success: false, error: 'Token do robô inválido ou revogado. Gere outro na aba Perfil do Central.' });
        if (!user.podeRodarRobo) return res.status(403).json({ success: false, error: 'Robô do PJe não liberado para este usuário. Peça ao administrador.' });
        req.currentUser = user;
        next();
    } catch (err) {
        logger.error('Erro ao verificar token do robô:', err);
        return res.status(500).json({ success: false, error: 'Erro interno ao verificar o token do robô' });
    }
}

module.exports = { requireRobo };
