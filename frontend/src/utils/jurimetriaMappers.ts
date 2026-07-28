/**
 * Tipos da UI de Jurimetria (Componentes React)
 */
export interface TeseInfoUI {
  id: string;
  nome: string;
  status: 'ascensao' | 'consolidada' | 'risco';
  volume: number;
  tendencia: number;
  movRecente?: number; // movimentações nos últimos 30 dias (métrica real do banco)
  movAnterior?: number; // movimentações nos 30 dias anteriores
  entidade: string;
  resumo: string;
  fundamentos: string[];
}

export interface PrecedenteInfoUI {
  id: string;
  tribunal: string;
  titulo: string;
  tipo: string;
  data: string;
  impacto: 'alto' | 'medio' | 'baixo';
}
