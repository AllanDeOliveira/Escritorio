import { Worker } from 'bullmq';
import { prisma, redisConnection, OUTCOME_QUEUE_NAME } from '../../infra';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_JURIMETRIA_API_KEY || process.env.GEMINI_API_KEY
});

/**
 * Worker responsável pela Análise Profunda de Desfechos (IA Deep).
 * Ele processa um lote de processos para uma tese específica e identifica
 * se as decisões foram procedentes ou improcedentes, gerando estatísticas.
 */
export const outcomeWorker = new Worker(
  OUTCOME_QUEUE_NAME,
  async (job) => {
    const { monitoringAreaId, teseName } = job.data;
    console.log(`[OutcomeWorker] Analisando desfechos para tese: ${teseName} na área ${monitoringAreaId}`);

    // 1. Buscar processos da área
    const area = await prisma.monitoringArea.findUnique({
      where: { id: monitoringAreaId },
      include: {
        analyses: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    });

    if (!area) throw new Error('Área não encontrada');

    const processes = await prisma.process.findMany({
      where: {
        court: { acronym: area.courtAcronym }
      },
      include: {
        movements: { orderBy: { date: 'desc' }, take: 10 }
      },
      take: 50 // Aumentado para 50 para garantir que encontre dados relevantes
    });

    console.log(`[OutcomeWorker] Encontrados ${processes.length} processos no banco para análise.`);

    if (processes.length === 0) {
      console.log('[OutcomeWorker] Nenhum processo encontrado para esta área.');
      return;
    }

    console.log(`[OutcomeWorker] Preparando prompt com ${processes.length} processos...`);

    // 2. Preparar contexto para a IA
    const batchData = processes.map((p: any) => ({
      numero: p.cnjNumber,
      classe: p.className,
      movimentacoes: p.movements.map((m: any) => `${m.date.toISOString().split('T')[0]}: ${m.description}`)
    }));

    const prompt = `
Atuação: Você é um Analista de Dados Judiciais focado em Desfechos Processuais.
Objetivo: Extrair a data de julgamento e o resultado (deferimento/indeferimento) de uma tese específica em um lote de processos.

Tese alvo: "${teseName}"

1. Instruções de Mapeamento
Para cada documento, identifique:
- Busca por Semelhança: Se não encontrar "${teseName}" literal, procure por pedidos ou termos correlatos.
- Data do Julgamento: Use a data da sentença ou do último movimento decisório.
- Resultado: Classifique em: "Favorável", "Parcial" ou "Desfavorável".

Lote de Processos (JSON):
${JSON.stringify(batchData, null, 2)}

3. Estrutura de Resposta (JSON EXCLUSIVO):
{
  "results": [
    {
      "data_decisao": "AAAA-MM-DD",
      "resultado": "Favorável" | "Desfavorável" | "Parcial",
      "tribunal": "${area.courtAcronym}",
      "trecho_decisivo": "Texto curto do dispositivo ou resumo do desfecho"
    }
  ],
  "statistics": {
    "timeline": { "AAAA-MM": total_no_mes },
    "successRate": 0.0,
    "inflectionPoint": "Resumo da tendência identificada"
  }
}
`;

    console.log(`[OutcomeWorker] Enviando para Gemini (Tese: ${teseName})...`);
    // Usando a sintaxe validada
    const result = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    const responseText = result.text;
    if (!responseText) throw new Error('Gemini retornou texto vazio');
    
    // Limpeza robusta de JSON
    const jsonStart = responseText.indexOf('{');
    const jsonEnd = responseText.lastIndexOf('}');
    const jsonStr = responseText.substring(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);

    // 3. Salvar no Banco
    await prisma.outcomeAnalysis.create({
      data: {
        monitoringAreaId,
        teseName,
        results: parsed.results,
        statistics: parsed.statistics
      }
    });

    console.log(`[OutcomeWorker] Análise concluída para ${teseName}`);
  },
  { connection: redisConnection }
);
