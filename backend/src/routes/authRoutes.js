const express = require('express');
const router = express.Router();
const logger = require('../infra/logger');
const prisma = require('../infra/prismaClient');
const auth = require('../infra/auth');
const { requireUser } = require('../middleware/requireUser');

// Limites de tentativa (como no Umbler Talk). ponytail: em memória, processo único.
const POR_IP_MAX = 10; // tentativas por minuto por IP: trocar de e-mail não passa daqui
const BLOQUEIO_APOS = 10; // senhas erradas seguidas no mesmo e-mail, de qualquer IP...
const BLOQUEIO_MS = 15 * 60_000; // ...travam aquele login por 15 min
const porIp = new Map(); // ip → { n, desde }
const falhas = new Map(); // email → { n, ate }

function estourouIp(ip) {
    const agora = Date.now();
    const c = porIp.get(ip);
    if (!c || agora - c.desde > 60_000) { porIp.set(ip, { n: 1, desde: agora }); return false; }
    c.n += 1;
    return c.n > POR_IP_MAX;
}

// Conferido quando o e-mail não existe: e-mail errado custa o mesmo tempo que senha errada
let hashFalso;

// POST /api/auth/login { email, senha }
router.post('/login', async (req, res) => {
    try {
        if (porIp.size > 10_000) porIp.clear(); // ponytail: teto de memória contra rotação de IP
        if (estourouIp(req.ip)) return res.status(429).json({ success: false, error: 'Muitas tentativas. Aguarde um minuto e tente de novo.' });

        const email = String(req.body?.email || '').trim().toLowerCase();
        const senha = String(req.body?.senha || '');
        if (!email || !senha || senha.length > 200) return res.status(400).json({ success: false, error: 'Informe e-mail e senha.' });
        const f = falhas.get(email);
        if (f && f.ate > Date.now()) return res.status(429).json({ success: false, error: 'Muitas tentativas para este usuário. Aguarde 15 minutos.' });

        const user = await prisma.user.findUnique({ where: { email } });
        const ok = await auth.verificarSenha(user?.passwordHash || (hashFalso ??= await auth.hashSenha('senha-falsa')), senha);
        if (!user || !user.passwordHash || !ok) {
            if (falhas.size > 10_000) falhas.clear();
            const c = falhas.get(email) || { n: 0, ate: 0 };
            c.n += 1;
            if (c.n >= BLOQUEIO_APOS) Object.assign(c, { n: 0, ate: Date.now() + BLOQUEIO_MS });
            falhas.set(email, c);
            return res.status(401).json({ success: false, error: 'E-mail ou senha inválidos.' });
        }
        falhas.delete(email);
        if (!user.ativo) return res.status(403).json({ success: false, error: 'Acesso desativado. Fale com o administrador.' });

        auth.gravarCookie(req, res, await auth.criarSessao(user.id));
        res.json({ success: true, user: auth.usuarioPublico(user) });
    } catch (error) {
        logger.error('[login] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao entrar.' });
    }
});

// POST /api/auth/logout — apaga a sessão no banco (o cookie sozinho não vale mais nada)
router.post('/logout', async (req, res) => {
    try {
        const token = auth.lerCookie(req);
        if (token) await auth.encerrarSessao(token);
        auth.apagarCookie(res);
        res.status(204).send();
    } catch (error) {
        logger.error('[logout] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao sair.' });
    }
});

// GET /api/auth/me — quem está logado (a tela usa ao abrir para saber se mostra o login)
router.get('/me', requireUser, (req, res) => {
    res.json({ success: true, user: auth.usuarioPublico(req.currentUser) });
});

module.exports = router;
module.exports.limites = { porIp, falhas }; // exposto para teste (zerar entre casos)
