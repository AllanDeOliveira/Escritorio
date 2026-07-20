import { ProcessType, MovementType } from '../types';

export interface BaseLegalAdapter {
  /**
   * Busca um processo completo pelo número CNJ
   */
  fetchProcess(cnj: string): Promise<{
    process: Partial<ProcessType>;
    movements: Partial<MovementType>[];
    rawPayload: any;
  }>;

  /**
   * Busca uma lista de processos baseada em filtros
   */
  searchProcesses(filters: Record<string, any>): Promise<string[]>;
}
