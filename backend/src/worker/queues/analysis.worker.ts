import { Job, Worker } from 'bullmq';
import { prisma, redisConnection, ANALYSIS_QUEUE_NAME } from '../../infra';
import { DataJudAdapter } from '../../shared';
import { GoogleGenAI } from '@google/genai';

const adapter = new DataJudAdapter();

// Removida a instância local do Prisma para usar a global
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_JURIMETRIA_API_KEY || process.env.GEMINI_API_KEY
});

/**
 * Worker responsável pela Análise Jurimétrica Geral.
 * Ele lê o histórico de movimentações de um lote de processos e usa IA para
 * identificar teses em ascensão, tendências de volume e precedentes relevantes.
 */
export const analysisWorker = new Worker(
  ANALYSIS_QUEUE_NAME,
  async (job: Job) => {
    const { monitoringAreaId } = job.data;

    console.log(`[Worker] Iniciando Análise Jurimétrica para Área: ${monitoringAreaId}`);

    const area = await prisma.monitoringArea.findUnique({ where: { id: monitoringAreaId } });
    if (!area) return { success: false, reason: 'Área não encontrada' };

    try {
      // 1. Janelas de tempo. Tendência mede ATIVIDADE recente (movimentos), porque
      //    o dataAjuizamento do DataJud vem quase sempre ausente/inválido nesta base.
      const agora = new Date();
      const corte30 = new Date(agora); corte30.setDate(corte30.getDate() - 30);
      const corte60 = new Date(agora); corte60.setDate(corte60.getDate() - 60);

      // Busca os processos da área COM assunto real (matéria jurídica TPU) e seus
      // movimentos dos últimos 60 dias, para medir aceleração por assunto.
      const processes = await prisma.process.findMany({
        where: { court: { acronym: area.courtAcronym }, subjectName: { not: null } },
        select: {
          subjectCode: true,
          subjectName: true,
          movements: { where: { date: { gte: corte60 } }, select: { date: true } },
        },
      });

      if (processes.length === 0) {
        console.log(`[Worker] Nenhum processo com assunto para a área ${area.name}`);
        return { success: true, message: 'Sem dados para análise' };
      }

      // 2. Agrega MÉTRICAS REAIS por assunto — volume = nº de processos;
      //    tendência = movimentos dos últimos 30 dias vs. os 30 anteriores.
      //    Nada disso é estimado pela IA.
      const porAssunto = new Map<string, { codigo: string | null; volume: number; recente: number; anterior: number }>();
      for (const p of processes) {
        const nome = p.subjectName as string;
        let e = porAssunto.get(nome);
        if (!e) { e = { codigo: p.subjectCode, volume: 0, recente: 0, anterior: 0 }; porAssunto.set(nome, e); }
        e.volume++;
        for (const m of p.movements) {
          if (m.date >= corte30) e.recente++;
          else e.anterior++; // já filtrado para >= corte60 na query
        }
      }

      const ranked = [...porAssunto.entries()]
        .map(([nome, e]) => {
          const bruto = e.anterior > 0
            ? Math.round(((e.recente - e.anterior) / e.anterior) * 100)
            : e.recente > 0 ? 100 : 0;
          // ponytail: capa em [-100, +300] — base pequena estoura o % (5→111 = +2120%),
          //           e limiares de status em ±15%; tudo calibrável com o escritório.
          const tendencia = Math.max(-100, Math.min(300, bruto));
          const status = tendencia >= 15 ? 'ascensao' : tendencia <= -15 ? 'risco' : 'consolidada';
          return { nome, codigo: e.codigo, volume: e.volume, tendencia, status, movRecente: e.recente, movAnterior: e.anterior };
        })
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 8); // top 8 assuntos por volume

      console.log(`[Worker] ${ranked.length} teses reais agregadas de ${processes.length} processos para ${area.name}`);

      // 3. IA só ENRIQUECE (polo/resumo/fundamentos) — nunca inventa número.
      //    Se a IA falhar, as teses reais continuam sendo salvas (só sem o texto).
      let enriquecimento: Record<string, any> = {};
      try {
        const lista = ranked.map(t => `- ${t.nome} (${t.volume} processos, tendência ${t.tendencia}%)`).join('\n');
        const prompt = `Você é um jurimetrista sênior. Abaixo está a lista REAL dos assuntos mais litigados no tribunal ${area.courtAcronym}, área "${area.name}", com volume e tendência já calculados a partir do banco de dados. NÃO recalcule nem invente números.

Para cada assunto, gere um enriquecimento qualitativo. Retorne EXCLUSIVAMENTE JSON no formato:
{
  "enriquecimento": {
    "<nome exato do assunto>": {
      "entidade": "Polo passivo típico (ex: Instituições Financeiras)",
      "resumo": "1-2 frases sobre a controvérsia jurídica central",
      "fundamentos": ["Fundamento jurídico 1", "Fundamento jurídico 2"]
    }
  }
}

Assuntos:
${lista}`;

        const result = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json' },
        });
        const responseText = result.text || '';
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}');
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          const parsed = JSON.parse(responseText.substring(jsonStart, jsonEnd + 1));
          enriquecimento = parsed.enriquecimento || {};
        }
      } catch (e: any) {
        console.warn(`[Worker] Enriquecimento IA falhou (${e.message}); salvando métricas reais sem resumo.`);
      }

      // 3b. Radar REAL: processos recentes no STJ sobre os mesmos assuntos TPU (fonte DataJud).
      //     Substitui os precedentes que antes eram gerados pela IA.
      let radar: any[] = [];
      try {
        const codes = ranked.map(t => t.codigo).filter(Boolean) as string[];
        const stj = await adapter.searchRecentSTJ(codes, 20);
        const top3 = new Set(ranked.slice(0, 3).map(t => t.nome));
        const porTema = new Map<string, number>();
        for (const h of stj) {
          const n = porTema.get(h.assuntoNome) || 0;
          if (n >= 2) continue; // no máx. 2 cards por assunto, para diversificar o radar
          porTema.set(h.assuntoNome, n + 1);
          const d = h.ultimaAtualizacao ? new Date(h.ultimaAtualizacao) : null;
          radar.push({
            id: String(radar.length + 1),
            titulo: `${h.assuntoNome} — ${h.classeNome} ${h.numeroProcesso}`,
            tribunal: 'STJ',
            data: d && !isNaN(d.getTime()) ? `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '',
            tipo: h.classeNome,
            impacto: top3.has(h.assuntoNome) ? 'alto' : 'medio',
          });
          if (radar.length >= 8) break;
        }
        console.log(`[Worker] Radar STJ: ${radar.length} processos reais encontrados.`);
      } catch (e: any) {
        console.warn(`[Worker] Radar STJ falhou (${e.message}); análise segue sem radar.`);
      }

      // 4. Monta o payload final: números reais + texto qualitativo da IA
      const teses = ranked.map((t, i) => {
        const enr = enriquecimento[t.nome] || {};
        return {
          id: String(i + 1),
          nome: t.nome,
          volume: t.volume,
          tendencia: t.tendencia,
          status: t.status,
          movRecente: t.movRecente,
          movAnterior: t.movAnterior,
          entidade: enr.entidade || 'Não identificado',
          resumo: enr.resumo || '',
          fundamentos: Array.isArray(enr.fundamentos) ? enr.fundamentos : [],
        };
      });

      const analysisObj = {
        teses,
        radar,
        metrics: {
          totalTeses: teses.length,
          emAscensao: teses.filter(t => t.status === 'ascensao').length,
          consolidadas: teses.filter(t => t.status === 'consolidada').length,
          risco: teses.filter(t => t.status === 'risco').length,
        },
      };

      // 5. Salva no banco de dados
      await prisma.areaAnalysis.create({
        data: { monitoringAreaId: area.id, analysis: JSON.stringify(analysisObj) },
      });

      console.log(`[Worker] Análise concluída (métricas reais) para a área ${area.name}`);
      return { success: true };

    } catch (error: any) {
      console.error(`[Worker] Erro na Análise da área ${area?.name}:`, error.message);
      throw error;
    }
  },
  { connection: redisConnection }
);

analysisWorker.on('completed', job => {
  console.log(`[Worker] Analysis Job ${job.id} finalizado.`);
});

analysisWorker.on('failed', (job, err) => {
  console.error(`[Worker] Analysis Job ${job?.id} falhou: ${err.message}`);
});
