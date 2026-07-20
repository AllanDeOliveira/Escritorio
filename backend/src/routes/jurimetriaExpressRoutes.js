const logger = require('../infra/logger');
const express = require('express');
const router = express.Router();
const prisma = require('../infra/prismaClient');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redisConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const discoveryQueue = new Queue('process-discovery', { connection: redisConnection });
const outcomeQueue = new Queue('process-outcome', { connection: redisConnection });

// ROTAS PARA AREAS DE MONITORAMENTO
router.post('/monitoring', async (req, res) => {
  try {
    const { name, courtAcronym, subjectCode, filters } = req.body;
    if (!name || !courtAcronym) {
        return res.status(400).json({ error: 'Name and courtAcronym are required' });
    }
    const area = await prisma.monitoringArea.create({
      data: {
        name,
        courtAcronym,
        subjectCode,
        filters: filters || {},
      }
    });

    await discoveryQueue.add(`discovery-${area.id}`, { monitoringAreaId: area.id });
    res.status(201).json(area);
  } catch (error) {
    logger.error('[createMonitoringArea] Erro fatal:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

router.get('/monitoring', async (req, res) => {
  try {
    const areas = await prisma.monitoringArea.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(areas);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Re-enfileira o discovery de uma área travada (análise nunca chegou por falha no pipeline)
router.post('/monitoring/:id/rescan', async (req, res) => {
  try {
    const { id } = req.params;
    const area = await prisma.monitoringArea.findUnique({ where: { id } });
    if (!area) return res.status(404).json({ error: 'Área não encontrada' });

    await discoveryQueue.add(`discovery-${id}-${Date.now()}`, { monitoringAreaId: id });
    res.status(202).json({ message: 'Análise reenfileirada com sucesso.' });
  } catch (error) {
    logger.error('[rescanArea] Erro:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/monitoring/:id/analysis', async (req, res) => {
  try {
    const { id } = req.params;
    const analysis = await prisma.areaAnalysis.findFirst({
      where: { monitoringAreaId: id },
      orderBy: { createdAt: 'desc' }
    });
    
    if (!analysis) {
      return res.status(202).json({ status: 'pending', message: 'Nenhuma análise encontrada para esta área ainda' });
    }
    
    const formattedAnalysis = {
      ...analysis,
      analysis: typeof analysis.analysis === 'string' ? JSON.parse(analysis.analysis) : analysis.analysis
    };

    res.json(formattedAnalysis);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.delete('/monitoring/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Auditoria: áreas vêm sendo excluídas sem rastro; registra quem pediu a exclusão
    logger.warn(`[deleteMonitoringArea] Exclusão da área ${id} solicitada por email=${req.headers['x-user-email'] || 'anônimo'} ip=${req.ip} ua=${(req.headers['user-agent'] || '').slice(0, 60)}`);
    await prisma.monitoringArea.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/monitoring/:id/outcomes', async (req, res) => {
  try {
    const { id } = req.params;
    const { teseName } = req.body;
    if (!teseName) return res.status(400).json({ error: 'teseName required' });

    await outcomeQueue.add(`outcome-${id}-${Date.now()}`, { monitoringAreaId: id, teseName });
    res.status(202).json({ message: 'Análise de desfechos enfileirada com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/monitoring/:id/outcomes', async (req, res) => {
  try {
    const { id } = req.params;
    const outcomes = await prisma.outcomeAnalysis.findMany({
      where: { monitoringAreaId: id },
      orderBy: { createdAt: 'desc' }
    });
    res.json(outcomes);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ROTAS DE PROCESSOS DATAJUD
router.get('/processes', async (req, res) => {
  try {
    const processes = await prisma.process.findMany({
      include: {
        movements: { orderBy: { date: 'desc' } },
        court: true,
        judgingBody: true,
        dataSource: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(processes);
  } catch (error) {
    logger.error('[listProcesses] Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
