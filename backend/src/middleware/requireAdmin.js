const prisma = require('../infra/prismaClient');
const logger = require('../infra/logger');

/**
 * Proteção "leve": confia no e-mail enviado pelo cliente no header x-user-email
 * e confere o role no banco. Não verifica um token assinado, então é spoofável
 * por quem souber o e-mail de um admin — não é autenticação de verdade.
 * Fechar essa lacuna requer validar o ID Token do Firebase no backend
 * (Firebase Admin SDK), pendente de credencial de service account.
 */
async function requireAdmin(req, res, next) {
    const email = req.headers['x-user-email'];

    if (!email) {
        return res.status(401).json({ success: false, error: 'Identificação do usuário ausente' });
    }

    try {
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user || user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Acesso restrito a administradores' });
        }

        req.adminUser = user;
        next();
    } catch (err) {
        logger.error('Erro ao verificar permissão de admin:', err);
        return res.status(500).json({ success: false, error: 'Erro interno ao verificar permissão' });
    }
}

module.exports = { requireAdmin };
