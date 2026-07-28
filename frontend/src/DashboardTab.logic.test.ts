import { describe, it, expect } from 'vitest';
import { resumoDePrazos } from './DashboardTab';

describe('resumoDePrazos', () => {
  it('conta cada bucket de urgência separadamente', () => {
    const r = resumoDePrazos([
      { bucket: 'vencido' }, { bucket: 'vencido' },
      { bucket: 'hoje' },
      { bucket: 'semana' }, { bucket: 'semana' }, { bucket: 'semana' },
    ]);
    expect(r).toEqual({ vencido: 2, hoje: 1, semana: 3 });
  });

  it('ignora buckets que não exigem ação (futuro, concluído, desconhecido)', () => {
    const r = resumoDePrazos([
      { bucket: 'vencido' },
      { bucket: 'futuro' }, { bucket: 'concluido' }, { bucket: 'lixo' },
    ]);
    expect(r).toEqual({ vencido: 1, hoje: 0, semana: 0 });
  });

  it('lista vazia devolve tudo zero', () => {
    expect(resumoDePrazos([])).toEqual({ vencido: 0, hoje: 0, semana: 0 });
  });
});
