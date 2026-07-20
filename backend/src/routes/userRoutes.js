const logger = require('../infra/logger');
const express = require('express');
const router = express.Router();
const prisma = require('../infra/prismaClient');

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
