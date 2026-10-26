const logger = require('../infra/logger');
const auth = require('../infra/auth');
const express = require('express');
const router = express.Router();
const prisma = require('../infra/prismaClient');
const { requireUser } = require('../middleware/requireUser');
const { requireAdmin } = require('../middleware/requireAdmin');

// Espelho das chaves de AREAS em frontend/src/PrazosTab.tsx — mudou lá, muda aqui.
const AREAS_VALIDAS = ['fazenda', 'previdenciario', 'bancario', 'trabalhista', 'civel', 'outras'];
const SENHA_MIN = 8;
const senhaFraca = (s) => typeof s !== 'string' || s.length < SENHA_MIN || s.length > 200;
const CAMPOS_EQUIPE = { id: true, name: true, email: true, noQuadro: true, ativo: true };

// Equipe para o seletor de responsável e para os perfis (admin)
router.get('/', requireUser, async (req, res) => {
    try {
        const users = await prisma.user.findMany({ select: CAMPOS_EQUIPE, orderBy: { name: 'asc' } });
        res.json({ success: true, users });
    } catch (error) {
        logger.error('Erro na rota GET /api/users:', error);
        res.status(500).json({ success: false, error: 'Erro ao listar a equipe.' });
    }
});

// Áreas que o usuário logado tria (filtro "Minhas áreas")
router.put('/me/areas', requireUser, async (req, res) => {
    try {
        const { areas } = req.body || {};
        if (!Array.isArray(areas)) return res.status(400).json({ success: false, error: 'areas deve ser uma lista.' });
        const invalidas = areas.filter((a) => !AREAS_VALIDAS.includes(a));
        if (invalidas.length) return res.status(400).json({ success: false, error: `Área(s) desconhecida(s): ${invalidas.join(', ')}` });
        const user = await prisma.user.update({ where: { id: req.currentUser.id }, data: { areas: [...new Set(areas)] } });
        res.json({ success: true, areas: user.areas });
    } catch (error) {
        logger.error('Erro na rota PUT /api/users/me/areas:', error);
        res.status(500).json({ success: false, error: 'Erro ao salvar as áreas.' });
    }
});

// Nome de exibição do próprio usuário
router.put('/me', requireUser, async (req, res) => {
    try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name) return res.status(400).json({ success: false, error: 'Informe o nome.' });
        const user = await prisma.user.update({ where: { id: req.currentUser.id }, data: { name } });
        res.json({ success: true, user: auth.usuarioPublico(user) });
    } catch (error) {
        logger.error('Erro na rota PUT /api/users/me:', error);
        res.status(500).json({ success: false, error: 'Erro ao salvar o nome.' });
    }
});

// Troca da própria senha: exige a atual. As outras sessões (outros navegadores) caem; esta continua.
router.put('/me/senha', requireUser, async (req, res) => {
    try {
        const { atual, nova } = req.body || {};
        if (!(await auth.verificarSenha(req.currentUser.passwordHash, atual))) return res.status(400).json({ success: false, error: 'Senha atual incorreta.' });
        if (senhaFraca(nova)) return res.status(400).json({ success: false, error: `A senha nova precisa ter ao menos ${SENHA_MIN} caracteres.` });
        await prisma.user.update({ where: { id: req.currentUser.id }, data: { passwordHash: await auth.hashSenha(nova) } });
        await prisma.sessao.deleteMany({ where: { userId: req.currentUser.id, id: { not: auth.idDoToken(auth.lerCookie(req)) } } });
        res.json({ success: true });
    } catch (error) {
        logger.error('Erro na rota PUT /api/users/me/senha:', error);
        res.status(500).json({ success: false, error: 'Erro ao trocar a senha.' });
    }
});

// Admin cadastra uma pessoa (nome, e-mail de login e senha inicial). O mesmo e-mail de novo com
// senha redefine a senha dela (e derruba as sessões abertas).
router.post('/', requireAdmin, async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const name = String(req.body?.name || '').trim();
        const senha = req.body?.senha;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: 'E-mail inválido.' });
        if (!name) return res.status(400).json({ success: false, error: 'Informe o nome.' });
        if (senhaFraca(senha)) return res.status(400).json({ success: false, error: `A senha precisa ter ao menos ${SENHA_MIN} caracteres.` });
        const passwordHash = await auth.hashSenha(senha);
        const user = await prisma.user.upsert({
            where: { email },
            update: { name, passwordHash, noQuadro: true },
            create: { email, name, passwordHash, noQuadro: true },
            select: CAMPOS_EQUIPE,
        });
        await prisma.sessao.deleteMany({ where: { userId: user.id, id: { not: auth.idDoToken(auth.lerCookie(req)) } } });
        res.status(201).json({ success: true, user });
    } catch (error) {
        logger.error('Erro na rota POST /api/users:', error);
        res.status(500).json({ success: false, error: 'Erro ao cadastrar o perfil.' });
    }
});

// Admin inclui/tira uma pessoa das colunas do quadro (não apaga o usuário nem os prazos dele)
router.put('/:id/quadro', requireAdmin, async (req, res) => {
    try {
        if (typeof req.body?.noQuadro !== 'boolean') return res.status(400).json({ success: false, error: 'noQuadro deve ser true ou false.' });
        const user = await prisma.user.update({ where: { id: req.params.id }, data: { noQuadro: req.body.noQuadro }, select: CAMPOS_EQUIPE });
        res.json({ success: true, user });
    } catch (error) {
        if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        logger.error('Erro na rota PUT /api/users/:id/quadro:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar o quadro.' });
    }
});

// Admin ativa/desativa (ex-funcionário): desativado não entra, e as sessões abertas caem na hora
router.put('/:id/ativo', requireAdmin, async (req, res) => {
    try {
        if (typeof req.body?.ativo !== 'boolean') return res.status(400).json({ success: false, error: 'ativo deve ser true ou false.' });
        if (!req.body.ativo && req.params.id === req.currentUser.id) return res.status(400).json({ success: false, error: 'Você não pode desativar a própria conta.' });
        const user = await prisma.user.update({ where: { id: req.params.id }, data: { ativo: req.body.ativo }, select: CAMPOS_EQUIPE });
        if (!user.ativo) await prisma.sessao.deleteMany({ where: { userId: user.id } });
        res.json({ success: true, user });
    } catch (error) {
        if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        logger.error('Erro na rota PUT /api/users/:id/ativo:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar o usuário.' });
    }
});

module.exports = router;
