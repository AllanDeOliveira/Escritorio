import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import DashboardTab, { type Resumo, type SyncStatus } from './DashboardTab';

const props = {
  recentes: [],
  loading: false,
  erro: false,
  nomeUsuario: 'Ana Souza',
  onRefresh: () => {},
  onNavigate: () => {},
  sync: null,
  onSyncNow: () => {},
  syncing: false,
  prazosHoje: [],
  prazosSemana: [],
};

const agora = new Date().toISOString();
const doisDiasAtras = new Date(Date.now() - 48 * 3600_000).toISOString();
const syncOk: SyncStatus = { lastSuccessAt: agora, lastError: null, stale: false };

const render = (over: Partial<React.ComponentProps<typeof DashboardTab>>) =>
  renderToString(<DashboardTab {...props} resumo={null} {...over} />);

const resumo = (o: Partial<Resumo> = {}): Resumo => ({ vencido: 0, hoje: 0, semana: 0, novas: 0, ...o });

describe('DashboardTab — invariante de segurança do estado de erro', () => {
  it('em erro, avisa que não carregou e NÃO renderiza os cards de contagem', () => {
    const html = render({ erro: true, resumo: null });
    expect(html).toContain('Não foi possível carregar');
    // O perigo real: um "0 vencidos" falso escondendo um prazo perdido.
    expect(html).not.toContain('dash-card--vencido');
    expect(html).not.toContain('dash-banner');
  });

  // Regressão: se o App um dia passar zeros em vez de null no erro (setResumo({vencido:0,...})),
  // a UI ainda assim NÃO pode exibir "0 vencidos". `erro` vence sobre `resumo`.
  it('em erro, recusa exibir contagens mesmo se receber um resumo zerado', () => {
    const html = render({ erro: true, resumo: resumo({ vencido: 0, hoje: 0 }) });
    expect(html).toContain('Não foi possível carregar');
    expect(html).not.toContain('dash-card--vencido');
  });

  it('em erro, recusa exibir contagens mesmo se receber números reais', () => {
    const html = render({ erro: true, resumo: resumo({ vencido: 3, hoje: 2, novas: 7 }) });
    expect(html).toContain('Não foi possível carregar');
    expect(html).not.toContain('dash-card--vencido');
    expect(html).not.toContain('dash-intimacoes');
  });

  // A invariante vale para TODO dado novo: nada de "✓ sincronizado" ou lista de
  // prazos tranquilizando o usuário ao lado de um fetch que falhou.
  it('em erro, não mostra o ✓ do sync nem as listas do digest', () => {
    const html = render({
      erro: true,
      resumo: resumo({ vencido: 3 }),
      sync: syncOk,
      prazosHoje: [{ id: '1', title: 'Contestação', caseReference: 'Silva vs Banco X' }],
      prazosSemana: [{ id: '2', title: 'Apelação' }],
    });
    expect(html).toContain('Não foi possível carregar');
    expect(html).not.toContain('sincronizado');
    expect(html).not.toContain('Contestação');
    expect(html).not.toContain('Apelação');
  });

  it('carregando pela primeira vez não mostra contagens', () => {
    const html = render({ loading: true, resumo: null });
    expect(html).not.toContain('dash-card--vencido');
  });
});

describe('DashboardTab — banner crítico', () => {
  it('aparece com vencidos e/ou vencendo hoje, com plural correto', () => {
    const html = render({ resumo: resumo({ vencido: 3, hoje: 2 }) });
    expect(html).toContain('dash-banner');
    expect(html).toContain('3');
    expect(html).toContain('prazos vencidos');
    expect(html).toContain('vencem hoje');
  });

  it('usa singular quando é só um', () => {
    const html = render({ resumo: resumo({ vencido: 1, hoje: 1 }) });
    expect(html).toContain('prazo vencido');
    expect(html).toContain('vence hoje');
  });

  it('NÃO aparece quando não há nada crítico (mas os cards aparecem)', () => {
    const html = render({ resumo: resumo({ semana: 4 }) });
    expect(html).not.toContain('dash-banner"');
    expect(html).toContain('dash-card--vencido');
  });
});

describe('DashboardTab — intimações', () => {
  it('destaca o badge só quando há intimações novas', () => {
    expect(render({ resumo: resumo({ novas: 5 }) })).toContain('dash-intimacoes-badge--on');
    expect(render({ resumo: resumo({ novas: 0 }) })).not.toContain('dash-intimacoes-badge--on');
  });
});

describe('DashboardTab — heartbeat do sync', () => {
  it('passada limpa e recente mostra o ✓ verde', () => {
    const html = render({ resumo: resumo(), sync: syncOk });
    expect(html).toContain('dash-sync--ok');
    expect(html).toContain('sincronizado');
  });

  it('stale mostra banner vermelho com "Buscar agora", nunca o ✓', () => {
    const html = render({
      resumo: resumo(),
      sync: { lastSuccessAt: doisDiasAtras, lastError: null, stale: true },
    });
    expect(html).toContain('dash-sync--stale');
    expect(html).toContain('desatualizadas');
    expect(html).toContain('Buscar agora');
    expect(html).toContain('há 2 dias');
    expect(html).not.toContain('dash-sync--ok');
  });

  // Sync que completou mas teve erro de API: as intimações daquela OAB não vieram.
  // Âmbar, nunca o ✓ limpo — senão o usuário confia num sync que não buscou nada.
  it('com lastError mostra âmbar e NÃO o ✓ limpo', () => {
    const html = render({
      resumo: resumo(),
      sync: { lastSuccessAt: agora, lastError: 'OAB 9309/MT: API indisponível', stale: false },
    });
    expect(html).toContain('dash-sync--warn');
    expect(html).toContain('API indisponível');
    expect(html).not.toContain('dash-sync--ok');
  });

  it('stale vence sobre lastError (o mais grave manda)', () => {
    const html = render({
      resumo: resumo(),
      sync: { lastSuccessAt: doisDiasAtras, lastError: 'API indisponível', stale: true },
    });
    expect(html).toContain('dash-sync--stale');
    expect(html).not.toContain('dash-sync--warn');
  });

  it('sem informação de sync não renderiza nada (não inventa um ✓)', () => {
    const html = render({ resumo: resumo(), sync: null });
    expect(html).not.toContain('dash-sync');
  });
});

describe('DashboardTab — digest', () => {
  // Âncora nas classes das seções: o texto "Vencem hoje"/"Esta semana" também é
  // rótulo dos cards de estatística, então casar por texto passaria à toa.
  it('lista os prazos de hoje e da semana com processo e responsável', () => {
    const html = render({
      resumo: resumo({ hoje: 1, semana: 1 }),
      prazosHoje: [{ id: '1', title: 'Contestação', caseReference: 'Silva vs Banco X', responsibleName: 'Ana' }],
      prazosSemana: [{ id: '2', title: 'Apelação', caseReference: 'Souza' }],
    });
    expect(html).toContain('dash-recentes-head--hoje');
    expect(html).toContain('Contestação');
    expect(html).toContain('Silva vs Banco X');
    expect(html).toContain('Ana');
    expect(html).toContain('dash-recentes-head--semana');
    expect(html).toContain('Apelação');
  });

  it('não renderiza seção vazia', () => {
    const html = render({ resumo: resumo(), prazosHoje: [], prazosSemana: [] });
    expect(html).not.toContain('dash-recentes-head--hoje');
    expect(html).not.toContain('dash-recentes-head--semana');
  });
});
