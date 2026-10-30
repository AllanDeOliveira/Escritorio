import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// gerarPrazosDoPje processa TODOS os expedientes e intimações do banco: só roda no banco
// descartável lexgen_audit (DATABASE_URL exportada no shell), nunca no de dev com dados reais.
const noAudit = String(process.env.DATABASE_URL || '').includes('/lexgen_audit');

describe.skipIf(!noAudit)('gerarPrazosDoPje (integração, banco lexgen_audit)', () => {
  const prisma = require('../infra/prismaClient');
  const { gerarPrazosDoPje, formatarCnj } = require('./pjePainel');
  const dia = (d) => new Date(2001, 4, d); // maio/2001: mês sem dado real
  const P1 = '00000011120018110001';
  const P2 = '00000022220018110002';
  const P3 = '00000033320018110003';
  const exp = (idExpediente, numeroProcesso, tipo, dataExpedicao, dataLimite = null) =>
    prisma.expedientePje.create({ data: { tribunal: 'TJMT', idExpediente, numeroProcesso, tipo, dataExpedicao, dataLimite } });
  const cardDe = async (idExpediente) => (await prisma.expedientePje.findFirst({ where: { idExpediente } })).prazoId;

  beforeAll(async () => {
    await prisma.intimacao.deleteMany();
    await prisma.expedientePje.deleteMany();
    await prisma.prazo.deleteMany();
  });
  afterAll(() => prisma.$disconnect());

  it('mesmo ato a N destinatários vira um card; outro tipo de ato no mesmo dia vira outro card', async () => {
    await exp('100', P1, 'Decisão', dia(10), dia(25));
    await exp('101', P1, 'Decisão', dia(10), dia(25)); // outro destinatário do mesmo ato
    await exp('102', P1, 'Intimação de pauta', dia(10)); // ato diferente, mesmo dia
    await gerarPrazosDoPje();
    expect(await cardDe('100')).toBe(await cardDe('101'));
    expect(await cardDe('102')).not.toBe(await cardDe('100'));
    expect(await prisma.prazo.count({ where: { caseReference: formatarCnj(P1) } })).toBe(2);
  });

  it('card do DJEN com data confirmada à mão: o PJe liga o expediente a ele, sem duplicar nem mexer na data', async () => {
    const djen = await prisma.prazo.create({
      data: { title: 'Cliente', caseReference: formatarCnj(P2), source: 'DJEN', status: 'PENDENTE', fatalDate: dia(28) },
    });
    await prisma.intimacao.create({
      data: { djenId: '__quadro_p2', numeroProcesso: formatarCnj(P2), tipoDocumento: 'Decisão', dataDisponibilizacao: dia(12), status: 'GERADA', prazoId: djen.id },
    });
    await exp('200', P2, 'Decisão', dia(10), dia(30));
    await gerarPrazosDoPje();
    expect(await cardDe('200')).toBe(djen.id);
    expect(await prisma.prazo.findUnique({ where: { id: djen.id } })).toMatchObject({ status: 'PENDENTE', fatalDate: dia(28), source: 'DJEN' });
    expect(await prisma.prazo.count({ where: { caseReference: formatarCnj(P2) } })).toBe(1);
  });

  it('ato NOVO no mesmo processo não é engolido pelo card do DJEN que já tem expediente', async () => {
    await exp('201', P2, 'Decisão', dia(20), dia(5 + 30)); // dias depois: outro ato, outro prazo
    await gerarPrazosDoPje();
    const novo = await cardDe('201');
    expect(novo).not.toBe(await cardDe('200'));
    expect(await prisma.prazo.findUnique({ where: { id: novo } })).toMatchObject({ source: 'PJE', status: 'PENDENTE' });
  });

  it('intimação nova não é ligada a card na lixeira (ficaria invisível): vira card próprio', async () => {
    const P4 = '00000044420018110004';
    const lixo = await prisma.prazo.create({
      data: { title: 'Excluído', caseReference: formatarCnj(P4), source: 'PJE', status: 'CANCELADO', fatalDate: dia(25) },
    });
    await prisma.expedientePje.create({ data: { tribunal: 'TJMT', idExpediente: '400', numeroProcesso: P4, tipo: 'Decisão', dataExpedicao: dia(10), prazoId: lixo.id } });
    await prisma.intimacao.create({
      data: { djenId: '__quadro_p4', numeroProcesso: formatarCnj(P4), tipoDocumento: 'Decisão', dataDisponibilizacao: dia(12), status: 'NOVA' },
    });
    await gerarPrazosDoPje();
    const i = await prisma.intimacao.findUnique({ where: { djenId: '__quadro_p4' }, include: { prazo: true } });
    expect(i.prazoId).not.toBe(lixo.id);
    expect(i.prazo).toMatchObject({ source: 'DJEN', status: 'A_CONFIRMAR' });
  });

  it('card "a confirmar" do DJEN continua sendo assumido pelo PJe (data limite do PJe)', async () => {
    const djen = await prisma.prazo.create({
      data: { title: 'Outro', caseReference: formatarCnj(P3), source: 'DJEN', status: 'A_CONFIRMAR', fatalDate: dia(12) },
    });
    await prisma.intimacao.create({
      data: { djenId: '__quadro_p3', numeroProcesso: formatarCnj(P3), tipoDocumento: 'Sentença', dataDisponibilizacao: dia(12), status: 'GERADA', prazoId: djen.id },
    });
    await exp('300', P3, 'Sentença', dia(10), dia(27));
    await gerarPrazosDoPje();
    expect(await cardDe('300')).toBe(djen.id);
    expect(await prisma.prazo.findUnique({ where: { id: djen.id } })).toMatchObject({ source: 'PJE', status: 'PENDENTE', fatalDate: dia(27) });
  });

  // gravarLeitura recebe o que o robô do PC leu (já validado pela rota). Tribunal só deste caso,
  // com datas atuais (a baixa automática ignora o que venceu há mais de 10 dias).
  it('gravarLeitura: cria os cards; tribunal com erro não mexe; leitura incompleta não dá baixa; completa dá', async () => {
    const { gravarLeitura } = require('./pjePainel');
    const T = 'TRF1 2º GRAU';
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const daqui = (n) => new Date(hoje.getTime() + n * 86_400_000);
    const lido = (idExpediente, numeroProcesso) => ({
      idExpediente, numeroProcesso, tipo: 'Intimação', destinatario: 'Cliente', meio: 'Sistema', orgao: '1ª Turma', partes: 'A X B',
      dataExpedicao: hoje, prazoDias: 15, cienciaPendente: false, dataCiencia: hoje, dataLimite: daqui(5),
      situacao: 'Ciência dada pelo destinatário direto ou indireto - pendente de resposta', jurisdicao: 'TRF1', caixa: null,
    });
    const A = lido('500', '00000055520018110005');
    const B = lido('501', '00000066620018110006');
    const statusDe = async (id) => (await prisma.prazo.findUnique({ where: { id: await cardDe(id) } })).status;

    await gravarLeitura([{ tribunal: T, itens: [A, B], incompletas: [] }], { usuario: 'Tester' });
    expect([await statusDe('500'), await statusDe('501')]).toEqual(['PENDENTE', 'PENDENTE']);
    expect(await prisma.systemSettings.findFirst()).toMatchObject({ pjeLastBy: 'Tester' });

    await gravarLeitura([{ tribunal: T, erro: 'SSO fora do ar' }], { usuario: 'Tester' });
    expect(await statusDe('501')).toBe('PENDENTE'); // erro não é "saiu do painel"

    await gravarLeitura([{ tribunal: T, itens: [A], incompletas: ['1ª Turma › Caixa: 1 de 2'] }], { usuario: 'Tester' });
    expect(await statusDe('501')).toBe('PENDENTE'); // caixa lida pela metade não prova que saiu

    await gravarLeitura([{ tribunal: T, itens: [A], incompletas: [] }], { usuario: 'Tester' });
    expect([await statusDe('500'), await statusDe('501')]).toEqual(['PENDENTE', 'CUMPRIDO']);
  });
});
