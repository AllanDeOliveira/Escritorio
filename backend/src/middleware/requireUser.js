const prisma = require('../infra/prismaClient');
const logger = require('../infra/logger');

/**
 * Proteção "leve": confia no e-mail enviado pelo cliente no header x-user-email
 * e confere que existe um User correspondente no banco. Não verifica um token
 * assinado, então é spoofável por quem souber o e-mail de alguém da equipe —
 * não é autenticação de verdade, só bloqueia acesso totalmente anônimo.
 * Ao contrário de requireAdmin, não exige role === 'admin' — qualquer membro
 * cadastrado passa. Fechar essa lacuna de verdade requer validar o ID Token
 * do Firebase no backend (Firebase Admin SDK).
 */
async function requireUser(req, res, next) {
    const email = req.headers['x-user-email'];

    if (!email) {
        return res.status(401).json({ success: false, error: 'Identificação do usuário ausente' });
    }

    try {
        const user = await prisma.user.findUnique({ where: { email } });

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
