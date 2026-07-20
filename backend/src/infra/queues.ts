/**
 * Configuração das filas do BullMQ para processamento assíncrono.
 * Define as conexões Redis e as instâncias das filas de Ingestão, Discovery, Análise e Desfechos.
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

export const INGESTION_QUEUE_NAME = 'process-ingestion';

export const ingestionQueue = new Queue(INGESTION_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
  },
});

export const DISCOVERY_QUEUE_NAME = 'process-discovery';
export const discoveryQueue = new Queue(DISCOVERY_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: true
  }
});

export const ANALYSIS_QUEUE_NAME = 'process-analysis';
export const analysisQueue = new Queue(ANALYSIS_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: { 
    attempts: 50,
    backoff: { type: 'fixed', delay: 60000 },
    removeOnComplete: true 
  }
});

export const OUTCOME_QUEUE_NAME = 'process-outcome';
export const outcomeQueue = new Queue(OUTCOME_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: { 
    attempts: 50,
    backoff: { type: 'fixed', delay: 60000 },
    removeOnComplete: true 
  }
});
