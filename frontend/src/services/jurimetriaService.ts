import { 
  aggregateProcessosToTeses, 
  mapProcessosToRadar
} from '../utils/jurimetriaMappers';
import type {
  TeseInfoUI,
  PrecedenteInfoUI
} from '../utils/jurimetriaMappers';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface JurimetriaFiltros {
  area?: string;
  tribunal?: string;
  busca?: string;
}

export interface DashboardMetrics {
  totalTeses: number;
  emAscensao: number;
  consolidadas: number;
  risco: number;
}

export interface JurimetriaDataPayload {
  teses: TeseInfoUI[];
  radar: PrecedenteInfoUI[];
  metrics: DashboardMetrics;
}

export const jurimetriaService = {
  /**
   * Obtém os dados unificados para a tela principal (Dashboard de Jurimetria)
   * Faz o fetch em paralelo das fontes necessárias.
   */
  async getDashboardData(): Promise<JurimetriaDataPayload> {
    try {
      // 1. Fetch de Teses (via agregação de processos recentes do tribunal X)
      const tesesResponse = await this.buscarProcessosDatajud(); 
      const tesesMapeadas = aggregateProcessosToTeses(tesesResponse);

      // 2. Fetch Radar Superiores (processos em STF/STJ)
      const radarResponse = await this.buscarProcessosDatajud();
      const radarMapeado = mapProcessosToRadar(radarResponse);

      // 3. Cálculo de métricas gerais no frontend baseado nos dados recebidos
      const metrics: DashboardMetrics = {
        totalTeses: tesesMapeadas.length,
        emAscensao: tesesMapeadas.filter(t => t.status === 'ascensao').length,
        consolidadas: tesesMapeadas.filter(t => t.status === 'consolidada').length,
        risco: tesesMapeadas.filter(t => t.status === 'risco').length,
      };

      return {
        teses: tesesMapeadas,
        radar: radarMapeado,
        metrics
      };
    } catch (error) {
      console.error('Falha ao carregar dados de Jurimetria', error);
      throw error; // Repassa para a UI tratar
    }
  },

  /**
   * Busca processos do banco de dados local
   */
  async buscarProcessosDatajud(): Promise<any> {
    try {
      const response = await fetch(`${API}/api/processes`);
      if (!response.ok) throw new Error('API Local offline');
      
      const processes: any[] = await response.json();
      
      // 2. Mapeia o formato do Banco de Dados (Prisma) para o formato esperado pela UI
      return processes.map(p => ({
        numeroProcesso: p.cnjNumber,
        classeProcessual: p.className || 'Não Informado',
        dataAjuizamento: p.filingDate || p.createdAt,
        tribunal: p.court?.acronym || 'Desconhecido',
        assuntos: [{ codigo: 0, nome: p.className || 'Geral' }], // Simplificado para o MVP
        movimentos: (p.movements || []).map((m: any) => ({
          codigo: m.code || 0,
          nome: m.description,
          dataHora: m.date
        }))
      }));

    } catch (error) {
      console.warn('API Local falhou ou vazia.', error);
      return [];
    }
  },


  /**
   * Busca todas as áreas de monitoramento cadastradas.
   */
  async fetchMonitoringAreas() {
    try {
      const res = await fetch(`${API}/api/monitoring`);
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  },

  /**
   * Busca a última análise geral (JSON do Gemini) para uma área.
   */
  async fetchAreaAnalysis(areaId: string) {
    try {
      const res = await fetch(`${API}/api/monitoring/${areaId}/analysis`);
      if (!res.ok) return null;
      const data = await res.json();
      
      // Proteção no Frontend: se a API retornar o campo analysis como string (JSON bruto), nós fazemos o parse aqui.
      if (data && typeof data.analysis === 'string') {
        try {
          data.analysis = JSON.parse(data.analysis);
        } catch (e) {
          console.error("Erro ao fazer parse da análise no frontend:", e);
        }
      }
      
      return data;
    } catch {
      return null;
    }
  },

  /**
   * Cria uma nova área de monitoramento no backend.
   */
  async createMonitoringArea(data: { name: string, courtAcronym: string, subjectCode?: string }) {
    const res = await fetch(`${API}/api/monitoring`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || `Erro no servidor (${res.status})`);
    }
    
    return res.json();
  },

  /**
   * Remove uma área de monitoramento.
   */
  async deleteMonitoringArea(areaId: string) {
    const res = await fetch(`${API}/api/monitoring/${areaId}`, {
      method: 'DELETE'
    });
    return res.ok;
  },

  /**
   * Busca o histórico de análises profundas (outcomes) de uma área.
   */
  async fetchOutcomeAnalyses(areaId: string) {
    try {
      const res = await fetch(`${API}/api/monitoring/${areaId}/outcomes`);
      if (!res.ok) return [];
      return res.json();
    } catch {
      return [];
    }
  },

  /**
   * Re-enfileira o discovery/análise de uma área travada.
   */
  async rescanArea(areaId: string) {
    const res = await fetch(`${API}/api/monitoring/${areaId}/rescan`, { method: 'POST' });
    return res.ok;
  },

  /**
   * Solicita ao backend o início de uma análise profunda de desfechos para uma tese.
   */
  async triggerOutcomeAnalysis(areaId: string, teseName: string) {
    const res = await fetch(`${API}/api/monitoring/${areaId}/outcomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teseName })
    });
    return res.ok;
  }
};
