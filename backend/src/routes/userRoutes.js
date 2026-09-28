const logger = require('../infra/logger');
const express = require('express');
const router = express.Router();
const prisma = require('../infra/prismaClient');
const { requireUser } = require('../middleware/requireUser');

// Espelho das chaves de AREAS em frontend/src/PrazosTab.tsx — mudou lá, muda aqui.
const AREAS_VALIDAS = ['fazenda', 'previdenciario', 'bancario', 'trabalhista', 'civel', 'outras'];

// Equipe para o seletor de responsável. requireUser por rota: o router é
// montado aberto porque /sync roda antes do login.
router.get('/', requireUser, async (req, res) => {
    try {
        const users = await prisma.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } });
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

// Sincroniza o usuário (Cria ou Retorna)
router.post('/sync', async (req, res) => {
    try {
        const { email, name, forceUpdate } = req.body;
        
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email é obrigatório' });
        }

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
                    // organizationId não é obrigatório no schema agora
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
