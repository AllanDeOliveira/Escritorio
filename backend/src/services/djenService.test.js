import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { extrairCliente, extrairAdvogado, isSyncStale, heartbeatPatch } = require('./djenService');

describe('extrairCliente', () => {
  it('usa o destinatário do polo ativo quando disponível', () => {
    const item = {
      destinatarios: [
        { nome: 'ESTADO DE MATO GROSSO', polo: 'P' },
        { nome: 'MARIA APARECIDA DA SILVA', polo: 'A' },
      ],
      texto: '',
    };
    expect(extrairCliente(item)).toBe('MARIA APARECIDA DA SILVA');
  });

  it('ignora "USUÁRIO DO SISTEMA" e cai para o regex no teor', () => {
    const item = {
      destinatarios: [{ nome: 'USUÁRIO DO SISTEMA', polo: 'A' }],
      texto: 'Processo 123 REQUERENTE: JOSE GOMES DA SILVA REQUERIDO: ESTADO DE MATO GROSSO Vistos.',
    };
    expect(extrairCliente(item)).toBe('JOSE GOMES DA SILVA');
  });

  it('reconhece EXEQUENTE no teor', () => {
    const item = {
      destinatarios: [],
      texto: 'CUMPRIMENTO DE SENTENÇA. EXEQUENTE: ANTONIA PEREIRA LEITE ADVOGADO: FULANO OAB 1',
    };
    expect(extrairCliente(item)).toBe('ANTONIA PEREIRA LEITE');
  });

  it('retorna null quando não há nada extraível', () => {
    expect(extrairCliente({ destinatarios: [], texto: 'Intimação das partes.' })).toBeNull();
    expect(extrairCliente({ texto: '' })).toBeNull();
  });
});

describe('extrairAdvogado', () => {
  it('extrai o nome do primeiro advogado destinatário', () => {
    const item = {
      destinatarioadvogados: [{ advogado: { nome: 'JESUS VIEIRA DE OLIVEIRA', numero_oab: '9309-O' } }],
    };
    expect(extrairAdvogado(item)).toBe('JESUS VIEIRA DE OLIVEIRA');
  });

  it('retorna null sem advogado estruturado', () => {
    expect(extrairAdvogado({ destinatarioadvogados: [] })).toBeNull();
    expect(extrairAdvogado({})).toBeNull();
  });
});

describe('isSyncStale', () => {
  const agora = new Date('2026-07-09T08:00:00');
  const hAtras = (h) => new Date(agora.getTime() - h * 60 * 60 * 1000);

  it('nunca sincronizado = stale (nunca presumir que está em dia)', () => {
    expect(isSyncStale(null, agora)).toBe(true);
    expect(isSyncStale(undefined, agora)).toBe(true);
  });

  it('sync recente não é stale', () => {
    expect(isSyncStale(agora, agora)).toBe(false);
    expect(isSyncStale(hAtras(25), agora)).toBe(false); // folga do run das 06:30
  });

  it('mais de 26h sem sync limpo = stale', () => {
    expect(isSyncStale(hAtras(27), agora)).toBe(true);
    expect(isSyncStale(hAtras(72), agora)).toBe(true);
  });

  it('aceita string ISO (vem do banco assim via JSON)', () => {
    expect(isSyncStale(hAtras(27).toISOString(), agora)).toBe(true);
  });
});

// Guarda da correção crítica: a API do DJEN falha SEM lançar (fetchPagina desiste
// após 5 tentativas e o erro vai para `erros`). Carimbar djenLastSyncAt nesse caso
// faria o painel dizer "sincronizado agora" com o DJEN fora do ar há dias.
describe('heartbeatPatch', () => {
  const agora = new Date('2026-07-09T06:30:00');

  it('passada limpa carimba djenLastSyncAt', () => {
    const p = heartbeatPatch({ criadas: 3, erros: [] }, agora);
    expect(p.djenLastSyncAt).toBe(agora);
    expect(p.djenLastError).toBeNull();
    expect(p.djenLastCriadas).toBe(3);
  });

  it('QUALQUER erro impede o carimbo — mesmo tendo criado intimações (falha parcial)', () => {
    const p = heartbeatPatch({ criadas: 2, erros: ['OAB 9309/MT: API indisponível (página 1)'] }, agora);
    expect(p).not.toHaveProperty('djenLastSyncAt');
    expect(p.djenLastError).toContain('API indisponível');
    expect(p.djenLastCriadas).toBe(2);
  });

  it('DJEN fora do ar (0 criadas, erros) não carimba — é o cenário que motiva a regra', () => {
    const p = heartbeatPatch({ criadas: 0, erros: ['API indisponível'] }, agora);
    expect(p).not.toHaveProperty('djenLastSyncAt');
  });

  it('trunca erro longo para caber na coluna', () => {
    const p = heartbeatPatch({ criadas: 0, erros: ['x'.repeat(900)] }, agora);
    expect(p.djenLastError.length).toBe(500);
  });
});
