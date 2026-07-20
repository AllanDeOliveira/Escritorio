import { PrismaClient } from '@prisma/client';

// Compartilha a mesma instância que backend/src/infra/prismaClient.js (CJS,
// usado pelo Express) via `global`, que é o único estado realmente comum
// entre os dois sistemas de módulo quando rodam no mesmo processo Node
// (caso de produção: index.js faz `require('./dist/worker/worker.js')`
// quando RENDER=true). Sem isso, workers e Express abririam pools de
// conexão Postgres separados dentro do mesmo processo.
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

if (!global.prisma) {
  global.prisma = new PrismaClient();
}

export const prisma: PrismaClient = global.prisma;
export * from '@prisma/client';
