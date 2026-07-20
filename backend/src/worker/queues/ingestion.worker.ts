import { Job, UnrecoverableError, Worker } from 'bullmq';
import { prisma, redisConnection, INGESTION_QUEUE_NAME, ingestionQueue } from '../../infra';
import { DataJudAdapter } from '../../shared';

// Removida a instância local do Prisma para usar a global
const adapter = new DataJudAdapter();

/**
 * Worker responsável pela Ingestão de Processos.
 * Ele baixa os detalhes completos de um processo (andamentos, datas, partes)
 * via API do DataJud e salva no banco de dados PostgreSQL.
 */
export const ingestionWorker = new Worker(
  INGESTION_QUEUE_NAME,
  async (job: Job) => {
    const { cnj, dataSource: dataSourceName, monitoringAreaId } = job.data;
    
    console.log(`[Worker] Iniciando ingestão do processo: ${cnj} via ${dataSourceName}`);

    // 0. Se a ingestão foi engatilhada por uma área de monitoramento, verifica se ela ainda existe
    if (monitoringAreaId) {
      const area = await prisma.monitoringArea.findUnique({ where: { id: monitoringAreaId } });
      if (!area) {
        console.log(`[Worker] Cancelando ingestão de ${cnj}, pois a área ${monitoringAreaId} foi excluída.`);
        return { success: false, reason: 'Monitoring Area was deleted' };
      }
    }

    // 1. Garantir DataSource
    let dataSource = await prisma.dataSource.findUnique({ where: { name: dataSourceName } });
    if (!dataSource) {
      dataSource = await prisma.dataSource.create({ data: { name: dataSourceName } });
    }

    try {
      // 2. Fetch da API
      const result = await adapter.fetchProcess(cnj);
      
      // 3. Salvar o RawPayload Cru para Auditoria (Obrigatório)
      // Como o Processo pode não existir ainda, salvamos depois, mas se falhar, falha a transação inteira.
      
      // 4. Iniciar Transação do Prisma para salvar tudo atômicamente
      await prisma.$transaction(async (tx: any) => {
        // Obter ou criar o Tribunal (Court) mockado caso a API não retorne perfeitamente
        // Num fluxo real, extrairíamos a sigla do `result.rawPayload.siglaTribunal`
        const courtAcronym = result.rawPayload?.hits?.hits[0]?._source?.tribunal || 'DESCONHECIDO';
        let court = await tx.court.findUnique({ where: { acronym: courtAcronym } });
        if (!court) {
          court = await tx.court.create({ data: { acronym: courtAcronym, name: courtAcronym } });
        }

        // Criar ou atualizar o Processo
        const process = await tx.process.upsert({
          where: { cnjNumber: cnj },
          create: {
            cnjNumber: cnj,
            filingDate: result.process.filingDate,
            classId: result.process.classId,
            className: result.process.className,
            subjectCode: result.process.subjectCode,
            subjectName: result.process.subjectName,
            dataSourceId: dataSource.id,
            courtId: court.id
          },
          update: {
            filingDate: result.process.filingDate,
            classId: result.process.classId,
            className: result.process.className,
            subjectCode: result.process.subjectCode,
            subjectName: result.process.subjectName
          }
        });

        // Criar o RawPayload vinculado ao processo
        await tx.rawPayload.create({
          data: {
            processId: process.id,
            dataSourceId: dataSource.id,
            payload: typeof result.rawPayload === 'object' ? JSON.stringify(result.rawPayload) : String(result.rawPayload)
          }
        });

        // Apagar movimentos antigos e inserir os novos (modo Snapshot simples)
        await tx.movement.deleteMany({ where: { processId: process.id } });
        
        if (result.movements.length > 0) {
          await tx.movement.createMany({
            data: result.movements.map((mov: any) => ({
              processId: process.id,
              date: mov.date || new Date(),
              code: mov.code,
              description: mov.description || 'Sem descrição'
            }))
          });
        }
      });

      console.log(`[Worker] Sucesso ao salvar CNJ: ${cnj} no Banco de Dados.`);
      return { success: true, cnj };
      
    } catch (error: any) {
      // 429: pausa a fila inteira por 60s e devolve o job sem consumir tentativa
      if (error.status === 429) {
        console.warn(`[Worker] DataJud rate limit (429) em ${cnj} — pausando fila por 60s.`);
        await ingestionQueue.rateLimit(60_000);
        throw Worker.RateLimitError();
      }
      // Processo inexistente na API pública: re-tentar só desperdiça cota
      if (error.message?.includes('não encontrado')) {
        console.warn(`[Worker] ${cnj} não encontrado no DataJud — sem retry.`);
        throw new UnrecoverableError(error.message);
      }
      console.error(`[Worker] Erro crítico na ingestão de ${cnj}:`, error.message);
      // Jogar o erro para o BullMQ tentar novamente no backoff
      throw error;
    }
  },
  {
    connection: redisConnection,
    // ponytail: 60 req/min — metade do teto nominal do DataJud (120/min); suba se sobrar folga
    limiter: { max: 60, duration: 60_000 },
  }
);

ingestionWorker.on('completed', job => {
  console.log(`[Worker] Job ${job.id} finalizado.`);
});

ingestionWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} falhou: ${err.message}`);
});
