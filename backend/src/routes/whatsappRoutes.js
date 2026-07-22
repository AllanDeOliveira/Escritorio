const logger = require('../infra/logger');
const express = require('express');
const prisma = require('../infra/prismaClient');
const { state: whatsappState, getGroups } = require('../services/whatsappService.js');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json({
    status: whatsappState.status, // DISCONNECTED, WAITING_QR, CONNECTED
    qrCodeUrl: whatsappState.qrCodeUrl
  });
});

router.get('/groups', async (req, res) => {
  if (whatsappState.status !== 'CONNECTED') {
    return res.status(400).json({ error: 'WhatsApp não está conectado' });
  }
  try {
    const groups = await getGroups();
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar grupos' });
  }
});

router.get('/settings', async (req, res) => {
  try {
    let settings = await prisma.systemSettings.findFirst();
    if (!settings) {
      settings = await prisma.systemSettings.create({ data: {} });
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

router.post('/settings', async (req, res) => {
  const { whatsappGroupId, whatsappGroupName } = req.body;
  try {
    let settings = await prisma.systemSettings.findFirst();
    if (settings) {
      settings = await prisma.systemSettings.update({
        where: { id: settings.id },
        data: { whatsappGroupId, whatsappGroupName }
      });
    } else {
      settings = await prisma.systemSettings.create({
        data: { whatsappGroupId, whatsappGroupName }
      });
    }
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar configurações' });
  }
});

const { sendDirectMessage, logoutWhatsApp } = require('../services/whatsappService.js');
const { getGenAI } = require('../infra/genai');
const ai = getGenAI();

router.post('/test-message', async (req, res) => {
  try {
    const settings = await prisma.systemSettings.findFirst();
    if (!settings || !settings.whatsappGroupId) {
      return res.status(400).json({ error: 'Nenhum grupo foi configurado ainda.'});
    }

    const prompt = `Você é um robô de inteligência artificial jurídica. Comece a mensagem com @todos. Escreva uma mensagem curtinha (máximo 2 linhas) para enviar no grupo de WhatsApp notificando que a integração com o Gemini 2.5 Flash Lite e o sistema de marcação global (@todos) foram estabelecidos com sucesso. Use um emoji de raio ⚡.`;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: prompt
    });

    await sendDirectMessage(settings.whatsappGroupId, response.text);
    res.json({ success: true });
  } catch (err) {
    logger.error('ERRO NO TESTE IA:', err);
    res.status(500).json({ error: `Erro na IA: ${err.message}` });
  }
});

const { runDailyNotifications, runMonthlyNotifications } = require('../services/notificationService');

router.post('/send-hearings', async (req, res) => {
  try {
    await runDailyNotifications();
    res.json({ success: true, message: 'Processamento de audiências iniciado com sucesso.' });
  } catch (err) {
    logger.error('ERRO AO ENVIAR AUDIÊNCIAS:', err);
    res.status(500).json({ error: `Erro ao processar planilha: ${err.message}` });
  }
});

router.post('/send-monthly', async (req, res) => {
  try {
    await runMonthlyNotifications();
    res.json({ success: true, message: 'Relatório mensal solicitado com sucesso.' });
  } catch (err) {
    logger.error('ERRO AO ENVIAR MENSAL:', err);
    res.status(500).json({ error: `Erro no relatório mensal: ${err.message}` });
  }
});

router.post('/disconnect', async (req, res) => {
  try {
    await logoutWhatsApp();
    res.json({ success: true, message: 'WhatsApp desconectado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao tentar desconectar o WhatsApp.' });
  }
});

module.exports = router;
