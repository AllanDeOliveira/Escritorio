import { Job, Worker } from 'bullmq';
import { prisma, redisConnection, DISCOVERY_QUEUE_NAME, ingestionQueue, analysisQueue } from '../../infra';
import { DataJudAdapter } from '../../shared';

// Removida a instância local do Prisma para usar a global
const adapter = new DataJudAdapter();

/**
 * Worker responsável por descobrir novos números de processos (CNJs) no DataJud.
 * Ele pesquisa processos recentes baseados nos filtros da Área de Monitoramento
 * e envia os novos encontrados para a fila de Ingestão.
 */
export const discoveryWorker = new Worker(
  DISCOVERY_QUEUE_NAME,
  async (job: Job) => {
    const { monitoringAreaId } = job.data;
    
    console.log(`[Worker] Iniciando Discovery para Área: ${monitoringAreaId}`);

    const area = await prisma.monitoringArea.findUnique({ where: { id: monitoringAreaId } });
    if (!area || !area.active) return { success: false, reason: 'Área inativa ou não encontrada' };

    try {
      // 1. Busca CNJs recentes no DataJud
      const cnjs = await adapter.searchProcesses({
        courtAcronym: area.courtAcronym,
        subjectCode: area.subjectCode || undefined,
        daysAgo: 30 // Busca os últimos 30 dias para maior amostragem
      });

      console.log(`[Worker] Discovery encontrou ${cnjs.length} CNJs para a área ${area.name}`);

      // 2. Filtra os que já existem no banco
      const existingProcesses = await prisma.process.findMany({
        where: { cnjNumber: { in: cnjs } },
        select: { cnjNumber: true }
      });
      const existingCnjs = existingProcesses.map((p: any) => p.cnjNumber);
      
      const newCnjs = cnjs.filter((cnj: any) => !existingCnjs.includes(cnj));
      console.log(`[Worker] Dos quais ${newCnjs.length} são novos. Encaminhando para ingestão...`);

      // 3. Envia os novos para a fila de ingestão
      for (const cnj of newCnjs) {
        await ingestionQueue.add(`sync-${cnj}`, { cnj, dataSource: 'DATAJUD_CNJ', monitoringAreaId: area.id });
      }

      // 4. Atualiza a data de último scan e engatilha a análise.
      //    updateMany não explode se a área foi excluída durante o scan (race com o delete da UI).
      const upd = await prisma.monitoringArea.updateMany({
        where: { id: area.id },
        data: { lastScannedAt: new Date() }
      });
      if (upd.count === 0) {
        console.log(`[Worker] Área ${area.name} foi excluída durante o scan; análise não será engatilhada.`);
        return { success: false, reason: 'Área excluída durante o scan' };
      }

      // Engatilha a análise após o discovery (pode ser com delay para dar tempo da ingestão)
      await analysisQueue.add(`analyze-${area.id}`, { monitoringAreaId: area.id }, { delay: 60000 }); // 1 minuto de delay

      return { success: true, newFound: newCnjs.length };
      
    } catch (error: any) {
      console.error(`[Worker] Erro no Discovery da área ${area.name}:`, error.message);
      throw error;
    }
  },
  { connection: redisConnection }
);

discoveryWorker.on('completed', job => {
  console.log(`[Worker] Discovery Job ${job.id} finalizado.`);
});

discoveryWorker.on('failed', (job, err) => {
  console.error(`[Worker] Discovery Job ${job?.id} falhou: ${err.message}`);
});
