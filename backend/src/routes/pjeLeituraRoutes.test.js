import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const express = require('express');
const router = require('./pjeLeituraRoutes');
const prazosRoutes = require('./prazosRoutes');
const { requireUser } = require('../middleware/requireUser');
const pjePainel = require('../services/pjePainel');
const prisma = require('../infra/prismaClient');
const auth = require('../infra/auth');

// Só linhas próprias (usuário __test_ e os tokens dele, que caem em cascata). A gravação
// (que mexeria no quadro inteiro) é trocada por um dublê; a "última leitura" do banco também.
const EMAIL = '__test_robo__@jvo.adv.br';
let userId;
let token;
let server;
let base;

const req = (method, path, body, headers = { Authorization: `Bearer ${token}` }) =>
  fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const pedirVez = async () => (await (await req('POST', '/api/intimacoes/pje/vez')).json()).vez;

const item = (id, extra = {}) => ({ idExpediente: id, tipo: 'Decisão', dataLimite: '2026-11-05T04:00:00.000Z', prazoDias: 15, cienciaPendente: false, ...extra });

describe('rotas do robô do PJe (vez + leitura)', () => {
  beforeAll(async () => {
    ({ id: userId } = await prisma.user.upsert({ where: { email: EMAIL }, update: { ativo: true }, create: { email: EMAIL, name: 'Robô Teste' } }));
    token = auth.gerarTokenRobo();
    await prisma.tokenRobo.create({ data: { userId, hash: auth.idDoToken(token) } });
    const app = express();
    app.use('/api/intimacoes/pje', router); // antes do JSON global, como no index.js
    app.use(express.json());
    app.use('/api/prazos', requireUser, prazosRoutes);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(() => {
    router._zerarVez();
    vi.restoreAllMocks();
    // Última leitura há 1 hora: fora do tempo de espera
    vi.spyOn(prisma.systemSettings, 'findFirst').mockResolvedValue({ pjeLastAttemptAt: new Date(Date.now() - 3_600_000), pjeLastBy: 'Fulana' });
    vi.spyOn(pjePainel, 'gravarLeitura').mockResolvedValue({ resultado: [{ tribunal: 'TJMT', expedientes: 1 }], prazos: { criados: 1 } });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  it('sem token nem sessão → 401; token inventado → 401', async () => {
    expect((await req('POST', '/api/intimacoes/pje/vez', undefined, {})).status).toBe(401);
    expect((await req('POST', '/api/intimacoes/pje/vez', undefined, { Authorization: 'Bearer jvo_robo_falso' })).status).toBe(401);
  });

  it('o token do robô não vale no resto da API', async () => {
    expect((await req('GET', '/api/prazos')).status).toBe(401);
  });

  it('vez → leitura: grava só os campos do model, com datas convertidas, e libera a vez', async () => {
    const vez = await pedirVez();
    expect(vez).toBeTruthy();
    const r = await req('POST', '/api/intimacoes/pje/leitura', {
      versao: 1, vez,
      tribunais: [
        { tribunal: 'TJMT', itens: [item('1234567', { campoIntruso: 'x', partes: 'A X B' })], incompletas: [] },
        { tribunal: 'TRF1', erro: 'SSO fora do ar' },
      ],
    });
    expect(r.status).toBe(200);
    expect((await r.json()).prazos).toEqual({ criados: 1 });
    const [tribunais, opts] = pjePainel.gravarLeitura.mock.calls[0];
    expect(opts).toEqual({ usuario: 'Robô Teste' });
    expect(tribunais[0].itens[0]).not.toHaveProperty('campoIntruso');
    expect(tribunais[0].itens[0].dataLimite).toBeInstanceOf(Date);
    expect(tribunais[0].itens[0].partes).toBe('A X B');
    expect(tribunais[1]).toEqual({ tribunal: 'TRF1', erro: 'SSO fora do ar' });
    // a vez acabou: outro envio com o mesmo id é recusado
    expect((await req('POST', '/api/intimacoes/pje/leitura', { versao: 1, vez, tribunais: [] })).status).toBe(409);
  });

  it('ninguém lê duas vezes ao mesmo tempo: 2º pedido de vez → 409 (mesmo na mesma conta)', async () => {
    expect(await pedirVez()).toBeTruthy();
    const r = await req('POST', '/api/intimacoes/pje/vez');
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain('Robô Teste está lendo');
  });

  it('tempo de espera: última leitura há menos de 10 min → 429 dizendo quem leu e quando libera', async () => {
    prisma.systemSettings.findFirst.mockResolvedValue({ pjeLastAttemptAt: new Date(Date.now() - 60_000), pjeLastBy: 'Fulana' });
    const r = await req('POST', '/api/intimacoes/pje/vez');
    expect(r.status).toBe(429);
    const d = await r.json();
    expect(d.error).toContain('por Fulana');
    expect(new Date(d.liberaEm).getTime()).toBeGreaterThan(Date.now());
  });

  it('leitura sem vez → 409 e não grava', async () => {
    expect((await req('POST', '/api/intimacoes/pje/leitura', { versao: 1, vez: 'inventada', tribunais: [] })).status).toBe(409);
    expect(pjePainel.gravarLeitura).not.toHaveBeenCalled();
  });

  it('desistir (DELETE /vez) libera para o próximo', async () => {
    const vez = await pedirVez();
    expect((await req('DELETE', '/api/intimacoes/pje/vez', { vez })).status).toBe(204);
    expect(await pedirVez()).toBeTruthy();
  });

  it('tribunal desconhecido ou data inválida → 400 e não grava', async () => {
    let vez = await pedirVez();
    expect((await req('POST', '/api/intimacoes/pje/leitura', { versao: 1, vez, tribunais: [{ tribunal: 'TJXX', itens: [], incompletas: [] }] })).status).toBe(400);
    vez = await pedirVez();
    expect((await req('POST', '/api/intimacoes/pje/leitura', { versao: 1, vez, tribunais: [{ tribunal: 'TJMT', itens: [item('1', { dataLimite: 'ontem' })], incompletas: [] }] })).status).toBe(400);
    expect(pjePainel.gravarLeitura).not.toHaveBeenCalled();
  });

  it('aceita leitura de mais de 1 MB (o JSON global é 1 MB) e recusa acima de 10 MB (413)', async () => {
    const grande = (n) => Array.from({ length: n }, (_, i) => item(String(1_000_000 + i), { partes: 'P'.repeat(1900) }));
    let vez = await pedirVez();
    expect((await req('POST', '/api/intimacoes/pje/leitura', { versao: 1, vez, tribunais: [{ tribunal: 'TJMT', itens: grande(1500), incompletas: [] }] })).status).toBe(200);
    vez = await pedirVez();
    const r = await fetch(`${base}/api/intimacoes/pje/leitura`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ versao: 1, vez, tribunais: [{ tribunal: 'TJMT', itens: grande(6000), incompletas: [] }] }),
    });
    expect(r.status).toBe(413);
  });

  it('token revogado ou de usuário desativado → 401', async () => {
    await prisma.user.update({ where: { id: userId }, data: { ativo: false } });
    expect((await req('POST', '/api/intimacoes/pje/vez')).status).toBe(401);
    await prisma.user.update({ where: { id: userId }, data: { ativo: true } });
    await prisma.tokenRobo.updateMany({ where: { userId }, data: { revogadoEm: new Date() } });
    expect((await req('POST', '/api/intimacoes/pje/vez')).status).toBe(401);
  });
});
