import {
  AlertTriangle, CalendarClock, Inbox, ChevronRight, Loader2, RefreshCw, Activity,
  CheckCircle2, CloudOff, OctagonAlert, Clock, CalendarDays, CircleHelp,
} from 'lucide-react';
import './DashboardTab.css';

export interface PrazoBucketed { bucket: string; daysUntilFatal?: number }

// Conta prazos por bucket de urgência. Buckets desconhecidos (futuro/concluído/lixo)
// são ignorados de propósito — não entram no resumo de "o que exige ação agora".
// triagem = card sem data fatal; triagemVelha = parado há 2+ dias (exige ação).
export function resumoDePrazos(prazos: PrazoBucketed[]): { vencido: number; hoje: number; semana: number; triagem: number; triagemVelha: number } {
  const r = { vencido: 0, hoje: 0, semana: 0, triagem: 0, triagemVelha: 0 };
  for (const p of prazos) {
    if (p.bucket === 'vencido') r.vencido++;
    else if (p.bucket === 'hoje') r.hoje++;
    else if (p.bucket === 'semana') r.semana++;
    else if (p.bucket === 'triagem') { r.triagem++; if ((p.daysUntilFatal ?? 0) <= -2) r.triagemVelha++; }
  }
  return r;
}

export interface Resumo { vencido: number; hoje: number; semana: number; triagem: number; triagemVelha: number; novas: number }

/** Estado da última sincronização com o DJEN (`stale` vem calculado do servidor). */
export interface SyncStatus {
  lastSuccessAt: string | null;
  lastError: string | null;
  stale: boolean;
  criadas?: number;
  /** Última leitura do Painel do PJe (cron ou botão) — tribunais que falharam e quando cada um leu pela última vez. */
  pje?: {
    lastAttemptAt: string | null;
    lastBy?: string | null; // quem enviou a última leitura (robô do PC com o certificado)
    stale?: boolean; // sem leitura na rodada esperada: robô parado / PC desligado
    falhas: { tribunal: string; erro: string }[];
    ultimaLeitura?: Record<string, string | null>;
  };
}

/**
 * Faixa vermelha no topo de TODAS as abas enquanto algum tribunal não lê no PJe. Antes era uma
 * linha âmbar só na página inicial, com o motivo num tooltip: o TJMT ficou 5 dias fora sem ninguém ver.
 */
export function AlertaPje({ pje, onIrAoQuadro }: { pje?: SyncStatus['pje']; onIrAoQuadro: () => void }) {
  if (!pje) return null;
  // O robô roda no PC de quem tem o certificado: PC desligado não manda falha nenhuma, só atrasa
  const parado = Boolean(pje.stale);
  const falhas = pje.lastAttemptAt ? pje.falhas || [] : [];
  if (!parado && !falhas.length) return null;
  return (
    <div className="dash-sync dash-sync--stale alerta-pje" role="alert">
      <OctagonAlert size={18} />
      <span className="dash-sync-txt">
        {parado ? (
          <>
            <strong>{`Robô do PJe sem enviar leitura ${pje.lastAttemptAt ? tempoDesde(pje.lastAttemptAt) : 'até agora'}`}</strong>
            {' — prazos novos do PJe NÃO estão entrando no quadro. O PC com o certificado pode estar desligado ou sem ninguém logado.'}
            {pje.lastBy && <small className="alerta-pje-motivo">{`Última leitura enviada por ${pje.lastBy}.`}</small>}
          </>
        ) : (
          <>
            <strong>{`Robô do PJe sem ler ${falhas.map(f => f.tribunal).join(', ')}`}</strong>
            {' — prazos novos desse tribunal NÃO estão entrando no quadro.'}
          </>
        )}
        {falhas.map(f => (
          <small key={f.tribunal} className="alerta-pje-motivo">
            {`${f.tribunal}: última leitura ${tempoDesde(pje.ultimaLeitura?.[f.tribunal] ?? null)} · ${f.erro}`}
          </small>
        ))}
      </span>
      <button className="lx-btn-tool" onClick={onIrAoQuadro} title="A última leitura do PJe aparece no topo do quadro">
        <RefreshCw size={14} /> Ir ao quadro
      </button>
    </div>
  );
}

/** Prazo no digest. Usa `responsibleName` (texto livre) — a relação `responsible` não vem em /api/prazos. */
export interface PrazoLite {
  id: string;
  title?: string | null;
  caseReference?: string | null;
  responsibleName?: string | null;
}

interface DashboardTabProps {
  resumo: Resumo | null;
  loading: boolean;
  erro: boolean;
  nomeUsuario: string;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
  sync: SyncStatus | null;
  onSyncNow: () => void;
  syncing: boolean;
  prazosHoje: PrazoLite[];
  prazosSemana: PrazoLite[];
}

// O digest mostra só os primeiros; o resto está a um clique, no quadro.
const LIMITE_DIGEST = 8;

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** "há 2 dias" / "há 3 horas" — para o banner de sync desatualizado. */
export function tempoDesde(iso: string | null, agora: Date = new Date()): string {
  if (!iso) return 'nunca';
  const h = Math.floor((agora.getTime() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'há menos de uma hora';
  if (h < 24) return `há ${h} hora${h > 1 ? 's' : ''}`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d > 1 ? 's' : ''}`;
}

export default function DashboardTab({
  resumo, loading, erro, nomeUsuario, onRefresh, onNavigate,
  sync, onSyncNow, syncing, prazosHoje, prazosSemana,
}: DashboardTabProps) {
  const primeiroNome = nomeUsuario?.split(' ')[0] || 'Doutor(a)';
  const critico = resumo ? resumo.vencido + resumo.hoje + resumo.triagemVelha : 0;

  // Lista do digest de prazos.
  const listaPrazos = (itens: PrazoLite[], titulo: string, cls: string) => itens.length > 0 && (
    <div className="dash-recentes">
      <div className={`dash-recentes-head ${cls}`}><CalendarClock size={16} /> {titulo} ({itens.length})</div>
      <ul className="dash-recentes-list">
        {itens.slice(0, LIMITE_DIGEST).map(p => (
          <li key={p.id}>
            <button className="dash-recente" onClick={() => onNavigate('prazos')}>
              <span className="dash-recente-nome">{p.title || 'Prazo sem título'}</span>
              {p.caseReference && <span className="dash-recente-proc">{p.caseReference}</span>}
              {p.responsibleName && <span className="dash-recente-data">{p.responsibleName}</span>}
              <ChevronRight size={15} className="dash-banner-seta" />
            </button>
          </li>
        ))}
      </ul>
      {itens.length > LIMITE_DIGEST && (
        <button className="dash-recentes-mais" onClick={() => onNavigate('prazos')}>
          Ver os outros {itens.length - LIMITE_DIGEST} no quadro
        </button>
      )}
    </div>
  );

  return (
    <div className="lx-single-panel dash-panel lx-fade-up">
      <div className="dash-content">
        <div className="dash-greeting">
          <span className="dash-greeting-hi">Bem-vindo de volta, {primeiroNome}</span>
          <span className="dash-greeting-sub"><Activity size={14} /> Situação do escritório agora</span>
        </div>

        {/* Erro de carregamento: NUNCA mostrar contagens — um "0 vencidos" falso esconde um
            prazo perdido. `erro` vence sobre `resumo` de propósito: mesmo que alguém passe
            números aqui junto com erro, a UI se recusa a exibi-los. */}
        {erro ? (
          <div className="dash-erro">
            <AlertTriangle size={22} />
            <div className="dash-erro-txt">
              <strong>Não foi possível carregar o resumo.</strong>
              <span>Os números abaixo não estão disponíveis — não confie em "zero vencidos".</span>
            </div>
            <button className="lx-btn-tool" onClick={onRefresh}>
              <RefreshCw size={15} /> Atualizar
            </button>
          </div>
        ) : loading && !resumo ? (
          <div className="dash-loading"><Loader2 className="lx-spin" size={30} /></div>
        ) : resumo ? (
          <>
            {critico > 0 && (
              <button className="dash-banner" onClick={() => onNavigate('prazos')}>
                <AlertTriangle size={18} />
                <span>
                  {resumo.vencido > 0 && <strong>{resumo.vencido} {resumo.vencido === 1 ? 'prazo vencido' : 'prazos vencidos'}</strong>}
                  {resumo.vencido > 0 && resumo.hoje > 0 && ' · '}
                  {resumo.hoje > 0 && <span>{resumo.hoje} {resumo.hoje === 1 ? 'vence hoje' : 'vencem hoje'}</span>}
                  {(resumo.vencido > 0 || resumo.hoje > 0) && resumo.triagemVelha > 0 && ' · '}
                  {resumo.triagemVelha > 0 && <span>{resumo.triagemVelha} sem data fatal há mais de 2 dias</span>}
                </span>
                <ChevronRight size={16} className="dash-banner-seta" />
              </button>
            )}

            {/* Heartbeat do sync — três estados exclusivos. Nenhum tranquiliza à toa:
                o "✓" verde só aparece quando houve passada limpa e recente. */}
            {sync && (
              sync.stale ? (
                <div className="dash-sync dash-sync--stale">
                  <CloudOff size={17} />
                  <span className="dash-sync-txt">
                    Última busca no DJEN <strong>{tempoDesde(sync.lastSuccessAt)}</strong> — as intimações podem estar desatualizadas.
                  </span>
                  <button className="lx-btn-tool" onClick={onSyncNow} disabled={syncing}>
                    {syncing ? <Loader2 className="lx-spin" size={14} /> : <RefreshCw size={14} />}
                    {syncing ? 'Buscando...' : 'Buscar agora'}
                  </button>
                </div>
              ) : sync.lastError ? (
                <div className="dash-sync dash-sync--warn">
                  <AlertTriangle size={17} />
                  <span className="dash-sync-txt">Sincronizado com avisos: {sync.lastError}</span>
                  <button className="lx-btn-tool" onClick={onSyncNow} disabled={syncing}>
                    {syncing ? <Loader2 className="lx-spin" size={14} /> : <RefreshCw size={14} />}
                    {syncing ? 'Buscando...' : 'Tentar de novo'}
                  </button>
                </div>
              ) : sync.lastSuccessAt ? (
                <div className="dash-sync dash-sync--ok">
                  <CheckCircle2 size={17} />
                  <span className="dash-sync-txt">DJEN sincronizado às {formatHora(sync.lastSuccessAt)}</span>
                </div>
              ) : null
            )}

            {/* Falha do robô do PJe: faixa global no App (AlertaPje), em todas as abas */}

            <div className="dash-cards">
              {/* Cada nível tem ícone próprio: a urgência não depende só da cor */}
              <button className={`dash-card dash-card--vencido ${resumo.vencido === 0 ? 'dash-card--zero' : ''}`} onClick={() => onNavigate('prazos')}>
                <span className="dash-card-label">
                  {resumo.vencido === 0 ? <CheckCircle2 size={16} /> : <OctagonAlert size={16} />} Vencidos
                </span>
                <span className="dash-card-num">{resumo.vencido}</span>
              </button>
              <button className="dash-card dash-card--hoje" onClick={() => onNavigate('prazos')}>
                <span className="dash-card-label"><Clock size={16} /> Vencem hoje</span>
                <span className="dash-card-num">{resumo.hoje}</span>
              </button>
              <button className="dash-card dash-card--semana" onClick={() => onNavigate('prazos')}>
                <span className="dash-card-label"><CalendarDays size={16} /> Esta semana</span>
                <span className="dash-card-num">{resumo.semana}</span>
              </button>
              <button className="dash-card dash-card--triagem" onClick={() => onNavigate('prazos')}>
                <span className="dash-card-label"><CircleHelp size={16} /> A confirmar data</span>
                <span className="dash-card-num">{resumo.triagem}</span>
              </button>
            </div>

            <div className="dash-cols">
              {/* Digest da rotina matinal: quais prazos, não só quantos. */}
              <div className="dash-col">
                {listaPrazos(prazosHoje, 'Vencem hoje', 'dash-recentes-head--hoje')}
                {prazosHoje.length === 0 && listaPrazos(prazosSemana, 'Esta semana', 'dash-recentes-head--semana')}
              </div>
              <div className="dash-col">
                <button className="dash-intimacoes" onClick={() => onNavigate('prazos')}>
                  <Inbox size={20} />
                  <span className="dash-intimacoes-txt">Intimações recebidas hoje (já no quadro)</span>
                  <span className={`dash-intimacoes-badge ${resumo.novas > 0 ? 'dash-intimacoes-badge--on' : ''}`}>{resumo.novas}</span>
                  <ChevronRight size={16} className="dash-banner-seta" />
                </button>
                {prazosHoje.length > 0 && listaPrazos(prazosSemana, 'Esta semana', 'dash-recentes-head--semana')}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
