import {
  AlertTriangle, CalendarClock, Inbox, ChevronRight, Loader2, RefreshCw, Activity,
  CheckCircle2, CloudOff,
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
  /** Última leitura do Painel do PJe (cron ou botão) — tribunais que falharam. */
  pje?: { lastAttemptAt: string | null; falhas: { tribunal: string; erro: string }[] };
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
  onNavigate: (tab: string, opts?: { view?: 'board' | 'inbox' }) => void;
  sync: SyncStatus | null;
  onSyncNow: () => void;
  syncing: boolean;
  prazosHoje: PrazoLite[];
  prazosSemana: PrazoLite[];
}

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
        {itens.map(p => (
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

            {/* PJe: o cron falha calado (só log) — aqui o tribunal fora fica visível até ler de novo */}
            {sync?.pje?.lastAttemptAt && sync.pje.falhas?.length > 0 && (
              <div className="dash-sync dash-sync--warn">
                <AlertTriangle size={17} />
                <span className="dash-sync-txt">
                  PJe não leu <strong>{sync.pje.falhas.map(f => f.tribunal).join(', ')}</strong> na última busca
                  ({tempoDesde(sync.pje.lastAttemptAt)}) — prazos desse tribunal podem estar faltando no quadro.
                  {' '}<span title={sync.pje.falhas.map(f => `${f.tribunal}: ${f.erro}`).join('\n')} style={{ textDecoration: 'underline dotted', cursor: 'help' }}>ver motivo</span>
                </span>
                <button className="lx-btn-tool" onClick={() => onNavigate('prazos')} title='O botão "Buscar prazos no PJe" fica no quadro'>
                  <RefreshCw size={14} /> Ir ao quadro
                </button>
              </div>
            )}

            <div className="dash-cards">
              <button className="dash-card dash-card--vencido" onClick={() => onNavigate('prazos')}>
                <span className="dash-card-num">{resumo.vencido}</span>
                <span className="dash-card-label">Vencidos</span>
              </button>
              <button className="dash-card dash-card--hoje" onClick={() => onNavigate('prazos')}>
                <span className="dash-card-num">{resumo.hoje}</span>
                <span className="dash-card-label">Vencem hoje</span>
              </button>
              <button className="dash-card dash-card--semana" onClick={() => onNavigate('prazos')}>
                <span className="dash-card-num">{resumo.semana}</span>
                <span className="dash-card-label">Esta semana</span>
              </button>
              <button className="dash-card dash-card--triagem" onClick={() => onNavigate('prazos')}>
                <span className="dash-card-num">{resumo.triagem}</span>
                <span className="dash-card-label">A confirmar data</span>
              </button>
            </div>

            <button className="dash-intimacoes" onClick={() => onNavigate('prazos', { view: 'inbox' })}>
              <Inbox size={20} />
              <span className="dash-intimacoes-txt">Intimações recebidas hoje (já no quadro)</span>
              <span className={`dash-intimacoes-badge ${resumo.novas > 0 ? 'dash-intimacoes-badge--on' : ''}`}>{resumo.novas}</span>
              <ChevronRight size={16} className="dash-banner-seta" />
            </button>

            {/* Digest da rotina matinal: quais prazos, não só quantos. */}
            {listaPrazos(prazosHoje, 'Vencem hoje', 'dash-recentes-head--hoje')}
            {listaPrazos(prazosSemana, 'Esta semana', 'dash-recentes-head--semana')}
          </>
        ) : null}
      </div>
    </div>
  );
}
