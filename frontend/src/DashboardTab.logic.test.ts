import { describe, it, expect } from 'vitest';
import { resumoDePrazos } from './DashboardTab';

describe('resumoDePrazos', () => {
  it('conta cada bucket de urgência separadamente', () => {
    const r = resumoDePrazos([
      { bucket: 'vencido' }, { bucket: 'vencido' },
      { bucket: 'hoje' },
      { bucket: 'semana' }, { bucket: 'semana' }, { bucket: 'semana' },
    ]);
    expect(r).toEqual({ vencido: 2, hoje: 1, semana: 3, triagem: 0, triagemVelha: 0 });
  });

  it('ignora buckets que não exigem ação (futuro, concluído, desconhecido)', () => {
    const r = resumoDePrazos([
      { bucket: 'vencido' },
      { bucket: 'futuro' }, { bucket: 'concluido' }, { bucket: 'lixo' },
    ]);
    expect(r).toEqual({ vencido: 1, hoje: 0, semana: 0, triagem: 0, triagemVelha: 0 });
  });

  it('lista vazia devolve tudo zero', () => {
    expect(resumoDePrazos([])).toEqual({ vencido: 0, hoje: 0, semana: 0, triagem: 0, triagemVelha: 0 });
  });

  it('card "a confirmar" conta em triagem; parado 2+ dias também em triagemVelha', () => {
    const r = resumoDePrazos([
      { bucket: 'triagem', daysUntilFatal: 0 },
      { bucket: 'triagem', daysUntilFatal: -1 },
      { bucket: 'triagem', daysUntilFatal: -2 },
      { bucket: 'triagem', daysUntilFatal: -9 },
    ]);
    expect(r).toEqual({ vencido: 0, hoje: 0, semana: 0, triagem: 4, triagemVelha: 2 });
  });
});
