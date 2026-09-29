const logger = require('../infra/logger');
const auth = require('../infra/auth');
const express = require('express');
const router = express.Router();
const prisma = require('../infra/prismaClient');
const { requireUser } = require('../middleware/requireUser');
const { requireAdmin } = require('../middleware/requireAdmin');

// Espelho das chaves de AREAS em frontend/src/PrazosTab.tsx — mudou lá, muda aqui.
const AREAS_VALIDAS = ['fazenda', 'previdenciario', 'bancario', 'trabalhista', 'civel', 'outras'];

// Equipe para o seletor de responsável. requireUser por rota: o router é
// montado aberto porque /sync roda antes do login.
router.get('/', requireUser, async (req, res) => {
    try {
        const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, noQuadro: true }, orderBy: { name: 'asc' } });
        res.json({ success: true, users });
    } catch (error) {
        logger.error('Erro na rota GET /api/users:', error);
        res.status(500).json({ success: false, error: 'Erro ao listar a equipe.' });
    }
});

// Áreas que o usuário logado tria (filtro "Minhas áreas" da caixa de intimações)
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

// Admin cadastra um perfil no quadro de prazos (pode ser alguém que ainda não entrou:
// quando a pessoa fizer login com esse e-mail, o /sync encontra o mesmo registro).
router.post('/', requireAdmin, async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const name = String(req.body?.name || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: 'E-mail inválido.' });
        if (!name) return res.status(400).json({ success: false, error: 'Informe o nome.' });
        const user = await prisma.user.upsert({
            where: { email },
            update: { noQuadro: true },
            create: { email, name, noQuadro: true },
            select: { id: true, name: true, email: true, noQuadro: true },
        });
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
        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: { noQuadro: req.body.noQuadro },
            select: { id: true, name: true, email: true, noQuadro: true },
        });
        res.json({ success: true, user });
    } catch (error) {
        if (error.code === 'P2025') return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        logger.error('Erro na rota PUT /api/users/:id/quadro:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar o quadro.' });
    }
});

// Sincroniza o usuário (Cria ou Retorna)
// O e-mail vem do ID token verificado (conta @jvo.adv.br), nunca do corpo.
router.post('/sync', async (req, res) => {
    try {
        const r = await auth.emailDoToken(req);
        if (r.error) return res.status(r.status).json({ success: false, error: r.error });
        const { email } = r;
        const { name, forceUpdate } = req.body;

        // Verifica se o usuário existe
        let user = await prisma.user.findUnique({
            where: { email }
        });

        let isNew = false;

        if (!user) {
            // Se o usuário não existe, cria um novo
            user = await prisma.user.create({
                data: {
                    email,
                    name: name || null, // Se vier sem nome, ficará null
                }
            });
            isNew = true;
        } else if (name && (!user.name || forceUpdate)) {
            // Se o usuário existe mas não tinha nome salvo (ou foi forçado), atualiza
            user = await prisma.user.update({
                where: { email },
                data: { name }
            });
        }

        return res.json({ 
            success: true, 
            user, 
            isNew, 
            needsName: !user.name 
        });

    } catch (error) {
        logger.error("Erro na rota /api/users/sync:", error);
        return res.status(500).json({ success: false, error: 'Erro interno ao sincronizar usuário.' });
    }
});

module.exports = router;
