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
   * Cria uma nova área de monitoramento no backend. `filters` é opcional — sem ele,
   * a descoberta cai no comportamento padrão (últimos 30 dias, só o subjectCode acima).
   */
  async createMonitoringArea(data: {
    name: string,
    courtAcronym: string,
    subjectCode?: string,
    filters?: { subjectCodes?: string[], startDate?: string, endDate?: string, classCode?: string },
  }) {
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
