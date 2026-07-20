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
const post = async (path, body = {}) =>
  (await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).json();

describe('intimacoesRoutes (integração)', () => {
  beforeAll(async () => {
    await prisma.intimacao.createMany({
      data: [
        // A1+A2: mesmo processo+data+texto → cópias legítimas (1 ato)
        { djenId: `${PFX}a1`, numeroProcesso: PROC_A, texto: 'TXT-A', dataDisponibilizacao: new Date(2001, 4, 10), status: 'NOVA' },
        { djenId: `${PFX}a2`, numeroProcesso: PROC_A, texto: 'TXT-A', dataDisponibilizacao: new Date(2001, 4, 10), status: 'NOVA' },
        // B: MESMO texto genérico, processo diferente → NÃO pode agrupar com A
        { djenId: `${PFX}b`, numeroProcesso: PROC_B, texto: 'TXT-A', dataDisponibilizacao: new Date(2001, 4, 10), status: 'NOVA' },
        // C: mês seguinte (testa o filtro ?mes)
        { djenId: `${PFX}c`, numeroProcesso: PROC_B, texto: 'TXT-C', dataDisponibilizacao: new Date(2001, 5, 15), status: 'NOVA' },
        // D: GERADA órfã (prazo excluído → prazoId null)
        { djenId: `${PFX}d`, numeroProcesso: PROC_B, texto: 'TXT-D', dataDisponibilizacao: new Date(2001, 4, 20), status: 'GERADA', prazoId: null },
      ],
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.currentUser = { name: 'Tester', email: 'tester@test' }; next(); });
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

  it('agrupa por processo+data+texto: mesmo teor em processos distintos NÃO colapsa', async () => {
    const d = await get('/api/intimacoes?status=NOVA&mes=2001-05');
    expect(d.success).toBe(true);
    // 3 linhas cruas (A1, A2, B)...
    expect(d.intimacoes).toHaveLength(3);
    // ...mas 2 atos únicos: o par A e o B (mesmo texto, processo diferente)
    expect(d.counts.nova).toBe(2);
    // e a órfã D conta em gerada no mesmo mês
    expect(d.counts.gerada).toBe(1);
  });

  it('?mes restringe pela data de disponibilização', async () => {
    const jun = await get('/api/intimacoes?status=NOVA&mes=2001-06');
    expect(jun.intimacoes).toHaveLength(1);
    expect(jun.intimacoes[0].djenId).toBe(`${PFX}c`);
    expect(jun.counts.nova).toBe(1);
  });

  it('?mes inválido é ignorado (retorna sem recorte)', async () => {
    const d = await get('/api/intimacoes?status=NOVA&mes=banana');
    expect(d.success).toBe(true);
    const ids = d.intimacoes.map((i) => i.djenId);
    [`${PFX}a1`, `${PFX}a2`, `${PFX}b`, `${PFX}c`].forEach((id) => expect(ids).toContain(id));
  });

  it('gerar-prazo com grupoIds marca o grupo inteiro como GERADA e vincula o mesmo prazo', async () => {
    const lista = await get('/api/intimacoes?status=NOVA&mes=2001-05');
    const a1 = lista.intimacoes.find((i) => i.djenId === `${PFX}a1`);
    const a2 = lista.intimacoes.find((i) => i.djenId === `${PFX}a2`);

    const r = await post(`/api/intimacoes/${a1.id}/gerar-prazo`, {
      title: TITULO_PRAZO,
      fatalDate: '2001-05-30',
      grupoIds: [a2.id],
    });
    expect(r.success).toBe(true);

    const rows = await prisma.intimacao.findMany({ where: { djenId: { in: [`${PFX}a1`, `${PFX}a2`] } } });
    expect(rows.every((x) => x.status === 'GERADA')).toBe(true);
    expect(rows[0].prazoId).toBe(rows[1].prazoId);
    expect(rows[0].prazoId).toBeTruthy();
  });

  it('lista GERADA inclui o prazo vinculado (título e situação)', async () => {
    const d = await get('/api/intimacoes?status=GERADA&mes=2001-05');
    const a1 = d.intimacoes.find((i) => i.djenId === `${PFX}a1`);
    expect(a1.prazo?.title).toBe(TITULO_PRAZO);
    expect(a1.prazo?.status).toBe('PENDENTE');
  });

  it('descartar e restaurar transitam NOVA ↔ DESCARTADA', async () => {
    const lista = await get('/api/intimacoes?status=NOVA&mes=2001-05');
    const b = lista.intimacoes.find((i) => i.djenId === `${PFX}b`);

    const desc = await post(`/api/intimacoes/${b.id}/descartar`);
    expect(desc.success).toBe(true);
    expect(desc.atualizadas).toBe(1);

    const rest = await post(`/api/intimacoes/${b.id}/restaurar`);
    expect(rest.success).toBe(true);

    const row = await prisma.intimacao.findUnique({ where: { djenId: `${PFX}b` } });
    expect(row.status).toBe('NOVA');
    expect(row.revisadoPor).toBeNull();
  });

  it('restaurar reabre GERADA órfã (prazo excluído) para NOVA', async () => {
    const orfa = await prisma.intimacao.findUnique({ where: { djenId: `${PFX}d` } });
    const r = await post(`/api/intimacoes/${orfa.id}/restaurar`);
    expect(r.success).toBe(true);
    expect(r.atualizadas).toBe(1);

    const depois = await prisma.intimacao.findUnique({ where: { djenId: `${PFX}d` } });
    expect(depois.status).toBe('NOVA');
    expect(depois.prazoId).toBeNull();
  });

  it('restaurar NÃO reabre GERADA com prazo vivo', async () => {
    const a1 = await prisma.intimacao.findUnique({ where: { djenId: `${PFX}a1` } });
    const r = await fetch(`${base}/api/intimacoes/${a1.id}/restaurar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(404); // nada elegível para restaurar
    const depois = await prisma.intimacao.findUnique({ where: { djenId: `${PFX}a1` } });
    expect(depois.status).toBe('GERADA');
  });
});
