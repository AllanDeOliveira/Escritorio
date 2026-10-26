import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const express = require('express');
const router = require('./intimacoesRoutes');
const prisma = require('../infra/prismaClient');

// Linhas sintéticas em 2001 (meses sem dado real) permitem afirmar contagens exatas.
const PFX = '__test_int__';
const PROC_A = '0000001-11.2001.8.11.0001';
const PROC_B = '0000002-22.2001.8.11.0002';
const TITULO_PRAZO = '[TESTE-INT] Prazo de integração';

let server;
let base;

const get = async (path) => (await fetch(`${base}${path}`)).json();

describe('intimacoesRoutes (integração)', () => {
  beforeAll(async () => {
    const prazo = await prisma.prazo.create({
      data: { title: TITULO_PRAZO, caseReference: PROC_A, status: 'A_CONFIRMAR', source: 'DJEN', fatalDate: new Date(2001, 4, 10) },
    });
    await prisma.intimacao.createMany({
      data: [
        // A1+A2: cópias do mesmo ato, ligadas ao mesmo card
        { djenId: `${PFX}a1`, numeroProcesso: PROC_A, texto: 'TXT-A', dataDisponibilizacao: new Date(2001, 4, 10), status: 'GERADA', prazoId: prazo.id },
        { djenId: `${PFX}a2`, numeroProcesso: PROC_A, texto: 'TXT-A', dataDisponibilizacao: new Date(2001, 4, 10), status: 'GERADA', prazoId: prazo.id },
        { djenId: `${PFX}b`, numeroProcesso: PROC_B, texto: 'TXT-B', dataDisponibilizacao: new Date(2001, 4, 20), status: 'GERADA' },
        // C: mês seguinte (testa o filtro ?mes)
        { djenId: `${PFX}c`, numeroProcesso: PROC_B, texto: 'TXT-C', dataDisponibilizacao: new Date(2001, 5, 15), status: 'GERADA' },
      ],
    });

    const app = express();
    app.use(express.json());
    app.use('/api/intimacoes', router);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await prisma.intimacao.deleteMany({ where: { djenId: { startsWith: PFX } } });
    await prisma.prazo.deleteMany({ where: { title: TITULO_PRAZO } });
    await prisma.$disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  it('?prazoId traz só as intimações do card, com teor e hash (modal do quadro)', async () => {
    const { id } = await prisma.prazo.findFirst({ where: { title: TITULO_PRAZO } });
    const d = await get(`/api/intimacoes?prazoId=${id}`);
    expect(d.success).toBe(true);
    expect(d.intimacoes).toHaveLength(2); // a1 e a2; b e c não são deste card
    expect(d.intimacoes[0]).toMatchObject({ texto: 'TXT-A' });
    expect(d.intimacoes[0]).toHaveProperty('hash');
  });

  it('sem prazoId devolve só contadores e sync, nunca a lista inteira', async () => {
    const d = await get('/api/intimacoes?resumo=1');
    expect(d.success).toBe(true);
    expect(d.intimacoes).toBeUndefined();
    expect(typeof d.counts.hoje).toBe('number');
    expect(d.syncStatus).toBeTruthy();
  });

  it('a fila manual não existe mais: gerar-prazo/descartar/restaurar → 404', async () => {
    for (const acao of ['gerar-prazo', 'descartar', 'restaurar']) {
      const r = await fetch(`${base}/api/intimacoes/qualquer/${acao}`, { method: 'POST' });
      expect(r.status).toBe(404);
    }
  });
});
