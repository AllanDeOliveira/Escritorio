import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const express = require('express');
const router = require('./prazosRoutes');
const prisma = require('../infra/prismaClient');

// Só mexe nas próprias linhas (título com prefixo, maio/2001) e apaga no afterAll.
const TITULO = '[TESTE-LIXEIRA] Prazo';

let server;
let base;
let id;
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};

describe('lixeira (DELETE manda para CANCELADO)', () => {
  beforeAll(async () => {
    ({ id } = await prisma.prazo.create({ data: { title: TITULO, status: 'PENDENTE', fatalDate: new Date(2001, 4, 10) } }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.currentUser = { id: 'u-teste', name: 'Fulana Teste' }; next(); });
    app.use('/api/prazos', router);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await prisma.prazo.deleteMany({ where: { title: TITULO } });
    await prisma.$disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  it('excluir não apaga: vira CANCELADO com quem excluiu e quando, e sai do quadro', async () => {
    expect((await call('DELETE', `/api/prazos/${id}`)).status).toBe(204);
    const p = await prisma.prazo.findUnique({ where: { id } });
    expect(p).toMatchObject({ status: 'CANCELADO', lastMovedBy: 'Fulana Teste' });
    expect(p.lastMovedAt).toBeTruthy();
    const quadro = await call('GET', '/api/prazos?from=2001-05-01&to=2001-05-31');
    expect(quadro.json.prazos.map((x) => x.id)).not.toContain(id);
    const lixeira = await call('GET', '/api/prazos?status=CANCELADO&from=2001-05-01&to=2001-05-31');
    expect(lixeira.json.prazos.map((x) => x.id)).toContain(id);
  });

  it('restaurar (PUT status PENDENTE) devolve ao quadro', async () => {
    const r = await call('PUT', `/api/prazos/${id}`, { status: 'PENDENTE', lastMovedBy: 'x' });
    expect(r.json.prazo.status).toBe('PENDENTE');
    expect(r.json.prazo.lastMovedBy).toBe('Fulana Teste');
  });

  it('id inexistente continua 404', async () => {
    expect((await call('DELETE', '/api/prazos/nao-existe')).status).toBe(404);
  });
});
