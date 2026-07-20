export const CourtAcronyms = [
  'STF', 'STJ', 'TST', 'TSE', 'STM',
  'TRF1', 'TRF2', 'TRF3', 'TRF4', 'TRF5', 'TRF6',
  'TJAC', 'TJAL', 'TJAM', 'TJAP', 'TJBA', 'TJCE', 'TJDFT', 'TJES', 'TJGO',
  'TJMA', 'TJMG', 'TJMS', 'TJMT', 'TJPA', 'TJPB', 'TJPE', 'TJPI', 'TJPR',
  'TJRJ', 'TJRN', 'TJRO', 'TJRR', 'TJRS', 'TJSC', 'TJSE', 'TJSP', 'TJTO'
] as const;

export type CourtAcronym = typeof CourtAcronyms[number];

export const ProcessStatus = {
  ACTIVE: 'Ativo',
  ARCHIVED: 'Arquivado',
  SUSPENDED: 'Suspenso',
  JUDGED: 'Julgado'
} as const;

export type ProcessStatusType = typeof ProcessStatus[keyof typeof ProcessStatus];

export const DataSourceNames = {
  DATAJUD: 'DATAJUD_CNJ',
  PJE: 'PJE_GENERIC',
  JUSBRASIL: 'JUSBRASIL_SCRAPER'
} as const;
