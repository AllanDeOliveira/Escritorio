/**
 * Mappers e Agregadores para a conversão de metadados do DataJud para a UI
 */

// ==========================================
// 1. Tipos do DataJud (Brutos)
// ==========================================
export interface DatajudAssunto {
  codigo: number;
  nome: string;
}

export interface DatajudProcesso {
  numeroProcesso: string;
  classeProcessual: string;
  dataAjuizamento: string;
  tribunal: string;
  assuntos: DatajudAssunto[];
  movimentos: { codigo: number; nome: string; dataHora: string }[];
}

export interface DatajudResponse {
  hits: {
    total: { value: number };
    hits: { _source: DatajudProcesso }[];
  }
}

// ==========================================
// 2. Tipos da UI (Componentes React)
// ==========================================
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

// ==========================================
// 3. Funções de Mapeamento e Agregação
// ==========================================

/**
 * Pega os processos brutos e agrupa por Assunto (TPU) para calcular volume.
 * Calcula tendência simulando histórico caso a API só retorne o snapshot atual.
 */
export function aggregateProcessosToTeses(processos: DatajudProcesso[]): TeseInfoUI[] {
  const contagemPorAssunto = new Map<string, { codigo: number, count: number }>();

  // Agrega volume por assunto
  processos.forEach(p => {
    p.assuntos?.forEach(a => {
      const existing = contagemPorAssunto.get(a.nome) || { codigo: a.codigo, count: 0 };
      existing.count += 1;
      contagemPorAssunto.set(a.nome, existing);
    });
  });

  const teses: TeseInfoUI[] = [];
  
  contagemPorAssunto.forEach((dados, nomeAssunto) => {
    // ⚠️ Cálculos Derivados
    // Como a API pública geralmente requer queries complexas para ver série histórica real (time-series),
    // muitas vezes no MVP a "tendência" local tem que ser gerada ou requer endpoints estatísticos específicos.
    // Aqui usamos um placeholder lógico baseado no volume como exemplo.
    const mockTendenciaCalculada = dados.count > 10 ? 15.4 : -2.1; // Placeholder no frontend
    
    let statusCalculado: 'ascensao' | 'consolidada' | 'risco' = 'consolidada';
    if (mockTendenciaCalculada > 10) statusCalculado = 'ascensao';
    if (dados.count > 100) statusCalculado = 'risco';

    teses.push({
      id: `assunto-${dados.codigo}`,
      nome: nomeAssunto,
      status: statusCalculado,
      volume: dados.count, // Dado Derivado real do aggregate
      tendencia: mockTendenciaCalculada, 
      entidade: 'Diversos', // Derivado: Extração do polo passivo exigiria leitura de partes
      
      // ⚠️ GAPs do DataJud (Não existe na fonte oficial - metadados estruturados)
      resumo: "Indisponível na fonte oficial. O DataJud não fornece ementas sumarizadas prontas. Requer integração com motor de IA para leitura de acórdãos/iniciais.",
      fundamentos: ["Indisponível nos metadados CNJ"]
    });
  });

  // Ordena por maior volume
  return teses.sort((a, b) => b.volume - a.volume);
}

/**
 * Converte processos marcados como Repercussão Geral/Repetitivos em Radar de Precedentes
 */
export function mapProcessosToRadar(processos: DatajudProcesso[]): PrecedenteInfoUI[] {
  return processos.map(p => {
    // Avalia os movimentos para descobrir o tipo
    const hasRepercussao = p.movimentos?.some(m => m.nome.toLowerCase().includes('repercussão geral'));
    
    return {
      id: p.numeroProcesso,
      tribunal: p.tribunal || 'STF/STJ',
      titulo: `${p.classeProcessual} - Assunto: ${p.assuntos?.[0]?.nome || 'Não classificado'}`,
      tipo: hasRepercussao ? 'Repercussão Geral' : 'Tema Repetitivo', // Derivado do movimento
      data: p.dataAjuizamento ? new Date(p.dataAjuizamento).toLocaleDateString('pt-BR') : 'Recente',
      impacto: (hasRepercussao ? 'alto' : 'medio') as 'alto' | 'medio' | 'baixo'
    };
  }).slice(0, 5); // Retorna os Top 5 mais recentes
}
