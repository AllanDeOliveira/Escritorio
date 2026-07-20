import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { extrairCliente, extrairAdvogado } = require('./djenService');

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
