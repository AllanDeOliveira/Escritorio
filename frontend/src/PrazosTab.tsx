import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Check, Pencil, Trash2, X, CalendarClock, Loader2, Upload, Download, History,
  Inbox, RefreshCw, ExternalLink, RotateCcw, ArrowLeft, ChevronLeft, ChevronRight, Search,
} from 'lucide-react';
import './PrazosTab.css';

const API = import.meta.env.VITE_LEGACY_API_URL || 'http://localhost:3001';
const API_DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

const TYPES = ['JUDICIAL', 'ADMINISTRATIVO', 'INTERNO'];

const COLUMNS = [
  { key: 'vencido', label: 'Vencidos', cls: 'prazo-col--vencido' },
  { key: 'hoje', label: 'Hoje', cls: 'prazo-col--hoje' },
  { key: 'semana', label: 'Esta semana', cls: 'prazo-col--semana' },
  { key: 'futuro', label: 'Futuro', cls: 'prazo-col--futuro' },
  { key: 'concluido', label: 'Concluído', cls: 'prazo-col--concluido' },
] as const;

interface Prazo {
  id: string;
  title: string;
  description?: string;
  type: string;
  status: string;
  fatalDate: string;
  internalDate?: string | null;
  responsibleName?: string | null;
  caseReference?: string | null;
  lastMovedBy?: string | null;
  lastMovedAt?: string | null;
  daysUntilFatal: number;
  bucket: string;
}

type Groups = Record<string, Prazo[]>;

export interface Intimacao {
  id: string;
  numeroProcesso?: string | null;
  tribunal?: string | null;
  orgao?: string | null;
  tipoComunicacao?: string | null;
  tipoDocumento?: string | null;
  nomeClasse?: string | null;
  texto?: string | null;
  link?: string | null;
  hash?: string | null;
  dataDisponibilizacao?: string | null;
  clienteExtraido?: string | null;
  advogadoNome?: string | null;
  oabConsulta?: string | null;
  status: string;
  revisadoPor?: string | null;
  prazo?: PrazoVinculado | null;
}

// Resumo do prazo gerado a partir da intimação (aba "Viraram prazo")
type PrazoVinculado = Pick<Prazo, 'id' | 'title' | 'status' | 'fatalDate'> & { caseReference?: string | null };

type IntCounts = { nova: number; gerada: number; descartada: number };

// O DJEN publica o mesmo ato uma vez por destinatário/advogado; agrupamos essas
// cópias num card só, e as ações valem para o grupo inteiro. A chave é
// (processo + data + texto): agrupar só por texto colaria processos distintos
// que compartilham teor genérico (ex.: "Intimação acerca da expedição do alvará").
export type IntGroup = { rep: Intimacao; membros: Intimacao[]; ids: string[]; datas: string[] };

export function chaveAto(i: Intimacao): string {
  const data = i.dataDisponibilizacao ? i.dataDisponibilizacao.slice(0, 10) : '';
  return `${i.numeroProcesso || ''}|${data}|${i.texto || i.id}`;
}

// Colunas do kanban da caixa de intimações, por tipo de ato.
export const INT_COLUMNS = [
  { key: 'intimacao', label: 'Intimações', cls: 'prazo-int-col--intimacao' },
  { key: 'decisao', label: 'Decisões', cls: 'prazo-int-col--decisao' },
  { key: 'sentenca', label: 'Sentenças', cls: 'prazo-int-col--sentenca' },
  { key: 'despacho', label: 'Despachos', cls: 'prazo-int-col--despacho' },
  { key: 'outros', label: 'Outros', cls: 'prazo-int-col--outros' },
] as const;

type IntColKey = (typeof INT_COLUMNS)[number]['key'];

// Colunas com mais cards que isso ficam minimizadas com um "Ver mais".
const INT_CARDS_VISIVEIS = 5;
const PRAZO_CARDS_VISIVEIS = 6;

// Helpers do filtro de mês da caixa ('YYYY-MM')
export function mesAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

export function nomeMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Classifica pelo tipoDocumento do DJEN. Substrings escolhidas sem acento de
// propósito ("senten" pega Sentença; "decis" pega Decisão e suspensão;
// "intima" pega Intimação e pauta) — dispensa normalização de diacríticos.
export function tipoBucket(i: Intimacao): IntColKey {
  const t = (i.tipoDocumento || i.tipoComunicacao || '').toLowerCase();
  if (t.includes('senten')) return 'sentenca';
  if (t.includes('decis')) return 'decisao';
  if (t.includes('despacho')) return 'despacho';
  if (t.includes('intima') || t.includes('notifica')) return 'intimacao';
  return 'outros';
}

// Áreas do direito — taxonomia do escritório (não atende criminal): Fazenda Pública é a carteira
// de servidores contra o Estado (FGTS/férias); Justiça Federal → previdenciário
// (execuções contra o INSS incluídas). Varas mistas ("Criminal e Fazendário")
// caem pela matéria, não pelo nome do órgão.
export const AREAS = [
  { key: 'fazenda', label: 'Fazenda Pública' },
  { key: 'previdenciario', label: 'Previdenciário' },
  { key: 'bancario', label: 'Bancário' },
  { key: 'trabalhista', label: 'Trabalhista' },
  { key: 'civel', label: 'Cível' },
  { key: 'outras', label: 'Outras' },
] as const;

export type AreaKey = (typeof AREAS)[number]['key'];

export function areaDireito(i: Pick<Intimacao, 'nomeClasse' | 'orgao' | 'tribunal'>): AreaKey {
  const classe = (i.nomeClasse || '').toUpperCase();
  const org = (i.orgao || '').toUpperCase();
  const trib = (i.tribunal || '').toUpperCase();
  if (!classe && !org && !trib) return 'outras';
  if (trib.startsWith('TRT') || classe.includes('TRABALH') || org.includes('TRABALH')) return 'trabalhista';
  if (classe.includes('BANC') || org.includes('BANC')) return 'bancario';
  if (
    trib.startsWith('TRF') ||
    classe.includes('PREVIDENC') || org.includes('PREVIDENC') ||
    classe.includes('APOSENTADORIA') || classe.includes('BENEF')
  ) return 'previdenciario';
  if (classe.includes('FAZEND') || org.includes('FAZEND')) return 'fazenda';
  return 'civel';
}

// Busca por número do processo (ignora pontuação: "1124491" acha
// "1124491-82.2025.8.11.0041") ou por nome do cliente.
export function buscaMatch(i: Pick<Intimacao, 'numeroProcesso' | 'clienteExtraido'>, termo: string): boolean {
  const t = termo.trim().toLowerCase();
  if (!t) return true;
  const proc = (i.numeroProcesso || '').toLowerCase();
  const cliente = (i.clienteExtraido || '').toLowerCase();
  if (proc.includes(t) || cliente.includes(t)) return true;
  const dig = t.replace(/\D/g, '');
  return dig.length > 0 && proc.replace(/\D/g, '').includes(dig);
}

// "10787986920238110001" → "1078798-69.2023.8.11.0001" (máscara CNJ)
export function formatarNumeroCnj(n?: string | null): string {
  const d = String(n || '').replace(/\D/g, '');
  if (d.length !== 20) return String(n || '');
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
}

// Aviso pendente de ciência vindo do MNI/PJe (GET /api/mni/avisos)
export interface AvisoMni {
  idAviso?: string | null;
  tipoComunicacao?: string | null;
  dataDisponibilizacao?: string | null;
  numeroProcesso?: string | null;
  orgaoJulgador?: string | null;
  destinatario?: string | null;
}

export function agruparIntimacoes(list: Intimacao[]): IntGroup[] {
  const m = new Map<string, IntGroup>();
  list.forEach(i => {
    const k = chaveAto(i);
    const d = i.dataDisponibilizacao ? formatDate(i.dataDisponibilizacao) : null;
    const g = m.get(k);
    if (g) {
      g.membros.push(i);
      g.ids.push(i.id);
      if (d && !g.datas.includes(d)) g.datas.push(d);
    } else {
      m.set(k, { rep: i, membros: [i], ids: [i.id], datas: d ? [d] : [] });
    }
  });
  return [...m.values()];
}

interface PrazosTabProps {
  currentUser: any;
  dbUser: any;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  // View inicial ao montar (deep-link do dashboard: card de intimações → 'inbox')
  initialView?: 'board' | 'inbox';
}

const emptyForm = {
  title: '', caseReference: '', responsibleName: '',
  type: 'JUDICIAL', fatalDate: '', internalDate: '', description: '',
};

export function relativeLabel(days: number): string {
  // ponytail: mais de 10 anos é ano digitado errado na planilha, não prazo.
  // Prefiro admitir que a data é suspeita a imprimir "em 138583 dias" com cara de certeza.
  if (Math.abs(days) > 3650) return 'data suspeita';
  if (days < 0) return `atrasado ${Math.abs(days)} dia${Math.abs(days) > 1 ? 's' : ''}`;
  if (days === 0) return 'vence hoje';
  if (days === 1) return 'vence amanhã';
  return `em ${days} dias`;
}

function formatDate(iso: string): string {
  // Ano com 4 dígitos: com 2 dígitos, o ano 2406 aparecia como "05" e escondia o erro.
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function PrazosTab({ currentUser, dbUser, showToast, initialView = 'board' }: PrazosTabProps) {
  const [groups, setGroups] = useState<Groups>({ vencido: [], hoje: [], semana: [], futuro: [], concluido: [] });
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  // Drag-and-drop
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const dragged = useRef<{ prazo: Prazo; isDone: boolean } | null>(null);
  // Colunas do quadro expandidas (mostram todos os cards em vez dos primeiros)
  const [boardExpandidas, setBoardExpandidas] = useState<Record<string, boolean>>({});

  // Prompt "quem movimentou" (aceita o prazo do quadro ou o vinculado a uma intimação)
  const [moveModal, setMoveModal] = useState<{ prazo: Pick<Prazo, 'id' | 'title'> & { caseReference?: string | null }; targetStatus: string } | null>(null);
  const [moverName, setMoverName] = useState('');

  // Importação
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Caixa de entrada de intimações (DJEN). Monta na view pedida pelo dashboard.
  const [view, setView] = useState<'board' | 'inbox'>(initialView);
  const [intimacoes, setIntimacoes] = useState<Intimacao[]>([]);
  const [intCounts, setIntCounts] = useState<IntCounts>({ nova: 0, gerada: 0, descartada: 0 });
  const [intFilter, setIntFilter] = useState<'NOVA' | 'GERADA' | 'DESCARTADA'>('NOVA');
  // Mês exibido na caixa ('' = todos). Abre no mês vigente.
  const [intMes, setIntMes] = useState<string>(mesAtual);

  const mudarMes = (delta: number) => {
    const [y, m] = (intMes || mesAtual()).split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setIntMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setColAberta(null);
  };
  const [intLoading, setIntLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pubsAbertas, setPubsAbertas] = useState<string | null>(null);
  // Coluna aberta em tela cheia (todos os cards lado a lado); null = quadro normal
  const [colAberta, setColAberta] = useState<IntColKey | null>(null);
  const [gerandoDe, setGerandoDe] = useState<{ int: Intimacao; grupoIds: string[] } | null>(null);
  // Filtro por área do direito na caixa ('' = todas)
  const [intArea, setIntArea] = useState<AreaKey | ''>('');
  // Busca por número do processo ou cliente
  const [intBusca, setIntBusca] = useState('');

  // Pendentes de ciência no PJe via MNI (Fase 4 — somente leitura)
  const [mniAvisos, setMniAvisos] = useState<AvisoMni[] | null>(null);
  const [mniAberto, setMniAberto] = useState(false);
  const [mniLoading, setMniLoading] = useState(false);
  const mniTentado = useRef(false);

  const carregarMni = useCallback(async () => {
    setMniLoading(true);
    try {
      const r = await fetch(`${API}/api/mni/avisos`, { headers: authHeaders });
      const d = await r.json();
      // não configurado ou falha de login: painel simplesmente não aparece
      setMniAvisos(d.success && d.configurado ? d.avisos : null);
    } catch {
      setMniAvisos(null);
    } finally {
      setMniLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.email]);

  useEffect(() => {
    if (view === 'inbox' && !mniTentado.current) {
      mniTentado.current = true;
      carregarMni();
    }
  }, [view, carregarMni]);

  const authHeaders = { 'x-user-email': currentUser?.email || '' };
  const defaultMover = dbUser?.name || currentUser?.displayName || currentUser?.email || '';

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/prazos`, { headers: authHeaders });
      const d = await r.json();
      if (d.success) {
        const g: Groups = { vencido: [], hoje: [], semana: [], futuro: [], concluido: [] };
        (d.prazos as Prazo[]).forEach(p => { (g[p.bucket] || g.futuro).push(p); });
        setGroups(g);
      }
    } catch {
      showToast('Erro ao carregar prazos.', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.email]);

  useEffect(() => { carregar(); }, [carregar]);

  const carregarIntimacoes = useCallback(async (filter: 'NOVA' | 'GERADA' | 'DESCARTADA' = 'NOVA') => {
    setIntLoading(true);
    try {
      const r = await fetch(`${API}/api/intimacoes?status=${filter}${intMes ? `&mes=${intMes}` : ''}`, { headers: authHeaders });
      const d = await r.json();
      if (d.success) {
        setIntimacoes(d.intimacoes);
        setIntCounts(d.counts);
      }
    } catch {
      showToast('Erro ao carregar intimações.', 'error');
    } finally {
      setIntLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.email, intMes]);

  useEffect(() => { carregarIntimacoes(intFilter); }, [carregarIntimacoes, intFilter]);

  const sincronizarDjen = async () => {
    setSyncing(true);
    try {
      const r = await fetch(`${API}/api/intimacoes/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (d.success) {
        const erros = d.erros?.length ? ` · API instável em parte da busca` : '';
        showToast(`${d.criadas} nova(s) intimação(ões) encontrada(s)${erros}`, d.criadas > 0 ? 'success' : 'info');
        carregarIntimacoes(intFilter);
      } else {
        showToast(d.error || 'Falha ao consultar o DJEN.', 'error');
      }
    } catch {
      showToast('Erro de conexão com o DJEN.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const abrirGerarPrazo = (g: IntGroup) => {
    const i = g.rep;
    setGerandoDe({ int: i, grupoIds: g.ids.filter(id => id !== i.id) });
    setEditingId(null);
    setForm({
      title: i.clienteExtraido || i.numeroProcesso || '',
      caseReference: i.numeroProcesso || '',
      responsibleName: i.advogadoNome || '',
      type: 'JUDICIAL',
      fatalDate: '',
      internalDate: '',
      description: [i.tipoDocumento || i.tipoComunicacao, i.nomeClasse, i.tribunal, i.orgao].filter(Boolean).join(' · '),
    });
    setModalOpen(true);
  };

  const descartarIntimacao = (g: IntGroup) => {
    const plural = g.ids.length > 1 ? ` (${g.ids.length} publicações do mesmo ato)` : '';
    (window as any).showConfirm(`Descartar esta intimação${plural}? (não vira prazo)`, async () => {
      try {
        await fetch(`${API}/api/intimacoes/${g.rep.id}/descartar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ grupoIds: g.ids.filter(id => id !== g.rep.id) }),
        });
        showToast('Intimação descartada.', 'info');
        carregarIntimacoes(intFilter);
      } catch { showToast('Erro ao descartar.', 'error'); }
    });
  };

  const restaurarIntimacao = async (g: IntGroup) => {
    try {
      await fetch(`${API}/api/intimacoes/${g.rep.id}/restaurar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ grupoIds: g.ids.filter(id => id !== g.rep.id) }),
      });
      showToast('Intimação restaurada.', 'success');
      carregarIntimacoes(intFilter);
    } catch { showToast('Erro ao restaurar.', 'error'); }
  };

  const abrirNovo = () => { setGerandoDe(null); setEditingId(null); setForm({ ...emptyForm }); setModalOpen(true); };

  const abrirEdicao = (p: Prazo) => {
    setGerandoDe(null);
    setEditingId(p.id);
    setForm({
      title: p.title || '', caseReference: p.caseReference || '', responsibleName: p.responsibleName || '',
      type: p.type || 'JUDICIAL',
      fatalDate: p.fatalDate ? new Date(p.fatalDate).toISOString().slice(0, 10) : '',
      internalDate: p.internalDate ? new Date(p.internalDate).toISOString().slice(0, 10) : '',
      description: p.description || '',
    });
    setModalOpen(true);
  };

  const salvar = async () => {
    if (!form.title.trim() || !form.fatalDate) {
      showToast('Preencha ao menos o título e a data fatal.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        caseReference: form.caseReference.trim() || null,
        responsibleName: form.responsibleName.trim() || null,
        type: form.type,
        fatalDate: form.fatalDate, internalDate: form.internalDate || null,
        description: form.description.trim() || null,
      };
      const url = gerandoDe
        ? `${API}/api/intimacoes/${gerandoDe.int.id}/gerar-prazo`
        : editingId ? `${API}/api/prazos/${editingId}` : `${API}/api/prazos`;
      const body = gerandoDe ? { ...payload, grupoIds: gerandoDe.grupoIds } : payload;
      const r = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.success) {
        setModalOpen(false);
        showToast(gerandoDe ? 'Prazo gerado da intimação!' : editingId ? 'Prazo atualizado!' : 'Prazo criado!', 'success');
        if (gerandoDe) { setGerandoDe(null); carregarIntimacoes(intFilter); }
        carregar();
      } else {
        showToast(d.error || 'Erro ao salvar prazo.', 'error');
      }
    } catch {
      showToast('Erro de conexão ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const excluir = (p: Prazo) => {
    (window as any).showConfirm(`Excluir o prazo "${p.title}"?`, async () => {
      try {
        await fetch(`${API}/api/prazos/${p.id}`, { method: 'DELETE', headers: authHeaders });
        showToast('Prazo excluído.', 'info');
        carregar();
      } catch { showToast('Erro ao excluir.', 'error'); }
    });
  };

  // ── Drag and drop ────────────────────────────────────────────────
  const onDragStart = (p: Prazo) => { dragged.current = { prazo: p, isDone: p.bucket === 'concluido' }; };
  const onColDragOver = (e: React.DragEvent, colKey: string) => { e.preventDefault(); setDragOverCol(colKey); };
  const onColDragLeave = () => setDragOverCol(null);

  const onColDrop = (colKey: string) => {
    setDragOverCol(null);
    const d = dragged.current;
    dragged.current = null;
    if (!d) return;
    const targetIsDone = colKey === 'concluido';
    // Só há mudança de status entre "pendente" (qualquer coluna de urgência) e "concluído".
    // Arrastar entre colunas de urgência não muda nada (a coluna é definida pela data).
    if (targetIsDone === d.isDone) return;
    const targetStatus = targetIsDone ? 'CUMPRIDO' : 'PENDENTE';
    setMoverName(defaultMover);
    setMoveModal({ prazo: d.prazo, targetStatus });
  };

  const confirmarMovimentacao = async () => {
    if (!moveModal || !moverName.trim()) return;
    try {
      const r = await fetch(`${API}/api/prazos/${moveModal.prazo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ status: moveModal.targetStatus, lastMovedBy: moverName.trim() }),
      });
      const d = await r.json();
      if (d.success) {
        showToast(moveModal.targetStatus === 'CUMPRIDO' ? 'Prazo concluído!' : 'Prazo reaberto!', 'success');
        setMoveModal(null);
        carregar();
        if (view === 'inbox') carregarIntimacoes(intFilter); // atualiza o chip do prazo vinculado
      } else {
        showToast('Erro ao mover prazo.', 'error');
      }
    } catch {
      showToast('Erro de conexão.', 'error');
    }
  };

  // ── Importação ───────────────────────────────────────────────────
  const baixarModelo = async () => {
    try {
      const r = await fetch(`${API}/api/prazos/template`, { headers: authHeaders });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'modelo-prazos.xlsx';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { showToast('Erro ao baixar o modelo.', 'error'); }
  };

  const onImportFile = async (file: File) => {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('planilha', file);
      const r = await fetch(`${API}/api/prazos/import`, { method: 'POST', headers: authHeaders, body: fd });
      const d = await r.json();
      if (d.success) {
        const ign = d.ignoredNoDate ? ` · ${d.ignoredNoDate} sem data ignorada(s)` : '';
        showToast(`${d.imported} prazo(s) importado(s)!${ign}`, d.imported > 0 ? 'success' : 'info');
        setImportOpen(false);
        carregar();
      } else {
        showToast(d.error || 'Falha ao importar.', 'error');
      }
    } catch {
      showToast('Erro de conexão na importação.', 'error');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const totalPrazos = COLUMNS.reduce((acc, c) => acc + (groups[c.key]?.length || 0), 0);
  const count = (k: string) => groups[k]?.length || 0;
  const grupos = agruparIntimacoes(intimacoes);
  const gruposBuscados = intBusca.trim() ? grupos.filter(g => buscaMatch(g.rep, intBusca)) : grupos;
  const gruposFiltrados = intArea ? gruposBuscados.filter(g => areaDireito(g.rep) === intArea) : gruposBuscados;

  return (
    <div className="lx-single-panel prazo-panel">
      {/* Cabeçalho: título da visão à esquerda, ações da visão à direita.
          Os totais por urgência já aparecem no cabeçalho de cada coluna e no painel inicial. */}
      <div className="prazo-header">
        <div className="prazo-header-title">
          <h2>{view === 'inbox' ? 'Caixa de intimações' : 'Quadro de prazos'}</h2>
          <span className="prazo-header-sub">
            {view === 'inbox' ? 'Publicações do DJEN aguardando triagem' : 'Prazos ativos por urgência'}
          </span>
        </div>
        <div className="prazo-header-actions">
          <button
            className={`lx-btn-tool prazo-inbox-toggle ${view === 'inbox' ? 'prazo-inbox-toggle--active' : ''}`}
            onClick={() => setView(v => v === 'inbox' ? 'board' : 'inbox')}
          >
            {view === 'inbox' ? <ArrowLeft size={16} /> : <Inbox size={16} />}
            {view === 'inbox' ? 'Voltar ao quadro' : 'Notificações'}
            {view !== 'inbox' && intCounts.nova > 0 && <span className="prazo-inbox-badge">{intCounts.nova}</span>}
          </button>
          {view === 'inbox' ? (
            <button className="lx-btn-primary" onClick={sincronizarDjen} disabled={syncing}>
              {syncing ? <Loader2 className="lx-spin" size={16} /> : <RefreshCw size={16} />}
              {syncing ? 'Consultando DJEN...' : 'Buscar novas no DJEN'}
            </button>
          ) : (
            <>
              <button className="lx-btn-tool" onClick={() => setImportOpen(true)}>
                <Upload size={16} /> Importar planilha
              </button>
              <button className="lx-btn-primary" onClick={abrirNovo}>
                <Plus size={18} /> Novo Prazo
              </button>
            </>
          )}
        </div>
      </div>

      {view === 'inbox' ? (
        <div className="prazo-inbox">
          {mniAvisos !== null && mniAvisos.length > 0 && (
            <div className="prazo-mni">
              <div className="prazo-mni-head">
                <button type="button" className="prazo-mni-toggle" onClick={() => setMniAberto(!mniAberto)}>
                  <ChevronRight size={16} className={`prazo-carteira-seta ${mniAberto ? 'prazo-carteira-seta--aberta' : ''}`} />
                  <span className="prazo-mni-titulo">
                    PJe/TJMT: <strong>{mniAvisos.length}</strong> expediente{mniAvisos.length > 1 ? 's' : ''} pendente{mniAvisos.length > 1 ? 's' : ''} de ciência
                  </span>
                  {mniAvisos.some(a => a.tipoComunicacao === 'URG') && <span className="prazo-mni-urg">URGENTE na fila</span>}
                </button>
                <button
                  type="button"
                  className="prazo-inbox-mes-nav"
                  title="Atualizar consulta no PJe"
                  onClick={carregarMni}
                  disabled={mniLoading}
                >
                  {mniLoading ? <Loader2 className="lx-spin" size={14} /> : <RefreshCw size={14} />}
                </button>
              </div>
              {mniAberto && (
                <>
                  <ul className="prazo-mni-lista">
                    {mniAvisos.map((a, idx) => (
                      <li key={a.idAviso || idx} className="prazo-mni-item">
                        <span className={`prazo-mni-tipo ${a.tipoComunicacao === 'URG' ? 'prazo-mni-tipo--urg' : ''}`}>
                          {a.tipoComunicacao || 'INT'}
                        </span>
                        <button
                          type="button"
                          className="prazo-mni-proc"
                          title="Buscar este processo na caixa"
                          onClick={() => { setIntBusca(formatarNumeroCnj(a.numeroProcesso)); setIntMes(''); }}
                        >
                          {formatarNumeroCnj(a.numeroProcesso)}
                        </button>
                        <span className="prazo-mni-orgao">{a.orgaoJulgador || '—'}</span>
                        <span className="prazo-mni-data">{a.dataDisponibilizacao ? formatDate(a.dataDisponibilizacao) : ''}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="prazo-mni-aviso">
                    A ciência <strong>não</strong> é dada por aqui — este painel apenas monitora. Para tomar ciência,{' '}
                    <a href="https://pje.tjmt.jus.br/pje/login.seam" target="_blank" rel="noopener noreferrer">abra o expediente no PJe</a>.
                    Sem ação, a ciência tácita ocorre em 10 dias corridos.
                  </div>
                </>
              )}
            </div>
          )}
          <div className="prazo-inbox-toolbar">
            <div className="prazo-inbox-filters">
              {([['NOVA', `Novas (${intCounts.nova})`], ['GERADA', `Viraram prazo (${intCounts.gerada})`], ['DESCARTADA', `Descartadas (${intCounts.descartada})`]] as const).map(([k, label]) => (
                <button
                  key={k}
                  className={`prazo-inbox-filter ${intFilter === k ? 'prazo-inbox-filter--active' : ''}`}
                  onClick={() => { setIntFilter(k); setColAberta(null); }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="prazo-inbox-busca">
              <Search size={15} />
              <input
                value={intBusca}
                onChange={e => setIntBusca(e.target.value)}
                placeholder="Buscar processo ou cliente..."
                aria-label="Buscar por número do processo ou cliente"
              />
              {intBusca && (
                <button type="button" className="prazo-inbox-busca-limpar" onClick={() => setIntBusca('')} title="Limpar busca">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="prazo-inbox-mes">
              <button type="button" className="prazo-inbox-mes-nav" onClick={() => mudarMes(-1)} title="Mês anterior">
                <ChevronLeft size={16} />
              </button>
              <span className="prazo-inbox-mes-label">{intMes ? nomeMes(intMes) : 'Todos os meses'}</span>
              <button type="button" className="prazo-inbox-mes-nav" onClick={() => mudarMes(1)} title="Próximo mês">
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                className="prazo-inbox-mes-todos"
                onClick={() => { setIntMes(intMes ? '' : mesAtual()); setColAberta(null); }}
              >
                {intMes ? 'Ver todos' : 'Mês atual'}
              </button>
            </div>
            <div className="prazo-inbox-areas">
              <button
                type="button"
                className={`prazo-inbox-area ${intArea === '' ? 'prazo-inbox-area--active' : ''}`}
                onClick={() => { setIntArea(''); setColAberta(null); }}
              >
                Todas ({gruposBuscados.length})
              </button>
              {AREAS.map(a => {
                const n = gruposBuscados.filter(g => areaDireito(g.rep) === a.key).length;
                if (n === 0) return null;
                return (
                  <button
                    key={a.key}
                    type="button"
                    className={`prazo-inbox-area ${intArea === a.key ? 'prazo-inbox-area--active' : ''}`}
                    onClick={() => { setIntArea(intArea === a.key ? '' : a.key); setColAberta(null); }}
                  >
                    {a.label} ({n})
                  </button>
                );
              })}
            </div>
          </div>

          {intLoading ? (
            <div className="prazo-loading"><Loader2 className="lx-spin" size={32} /></div>
          ) : intimacoes.length === 0 ? (
            <div className="prazo-empty-all">
              <Inbox size={48} className="prazo-empty-icon" />
              <h3>{intFilter === 'NOVA' ? 'Nenhuma intimação nova' : 'Nada aqui'}</h3>
              {intFilter === 'NOVA' && <p>Clique em "Buscar novas no DJEN" para consultar as publicações das OABs do escritório.</p>}
            </div>
          ) : gruposFiltrados.length === 0 ? (
            <div className="prazo-empty-all">
              <Search size={48} className="prazo-empty-icon" />
              <h3>Nenhum resultado{intBusca.trim() ? ` para "${intBusca.trim()}"` : ''}</h3>
              {intMes ? (
                <>
                  <p>Não encontrei em {nomeMes(intMes)} — o processo pode ter publicações em outro mês.</p>
                  <button className="lx-btn-tool" onClick={() => setIntMes('')}>
                    Buscar em todos os meses
                  </button>
                </>
              ) : (
                <p>Confira o número digitado ou limpe os filtros de área.</p>
              )}
            </div>
          ) : (
            <div className={colAberta ? 'prazo-int-detail' : 'prazo-int-board'}>
              {(colAberta ? INT_COLUMNS.filter(c => c.key === colAberta) : INT_COLUMNS).map(col => {
                const colGrupos = gruposFiltrados.filter(g => tipoBucket(g.rep) === col.key);
                // Detalhe (colAberta): todos os cards lado a lado; quadro: só os primeiros
                const visiveis = colAberta ? colGrupos : colGrupos.slice(0, INT_CARDS_VISIVEIS);
                return (
                  <div key={col.key} className={`prazo-col prazo-int-col ${col.cls}`}>
                    <div className="prazo-col-header">
                      {colAberta && (
                        <button type="button" className="prazo-int-detail-voltar" onClick={() => setColAberta(null)}>
                          <ArrowLeft size={15} /> Voltar
                        </button>
                      )}
                      <span className="prazo-col-title">{col.label}</span>
                      <span className="prazo-col-count">{colGrupos.length}</span>
                    </div>
                    <div className="prazo-col-body">
                      {colGrupos.length === 0 ? (
                        <div className="prazo-col-empty">Nenhum</div>
                      ) : visiveis.map(g => {
                        const i = g.rep;
                        return (
                <div key={i.id} className="prazo-int-card">
                  <div className="prazo-int-head">
                    <div className="prazo-int-tags">
                      {i.tribunal && <span className="prazo-int-tag">{i.tribunal}</span>}
                      {g.datas.length > 0 && <span className="prazo-int-date">{g.datas.join(' · ')}</span>}
                      {(i.tipoDocumento || i.tipoComunicacao) && (
                        <span className={`prazo-int-tipo prazo-int-tipo--${tipoBucket(i)}`}>
                          {i.tipoDocumento || i.tipoComunicacao}
                        </span>
                      )}
                      {g.ids.length > 1 && (
                        <button
                          type="button"
                          className={`prazo-int-multi ${pubsAbertas === i.id ? 'prazo-int-multi--open' : ''}`}
                          onClick={() => setPubsAbertas(pubsAbertas === i.id ? null : i.id)}
                          title="O tribunal publicou este mesmo ato uma vez por destinatário/advogado. Clique para ver todas."
                        >
                          ×{g.ids.length} publicações
                        </button>
                      )}
                    </div>
                    {(i.hash || i.link) && (
                      <a
                        className="prazo-int-link"
                        href={i.hash ? `${API_DJEN}/${i.hash}/certidao` : i.link!}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={i.hash ? 'Abrir a certidão oficial da comunicação (PDF)' : 'Abrir no PJe do tribunal'}
                      >
                        <ExternalLink size={14} /> {i.hash ? 'Certidão (PDF)' : 'PJe'}
                      </a>
                    )}
                  </div>
                  {i.clienteExtraido && <div className="prazo-int-cliente">{i.clienteExtraido}</div>}
                  <div className="prazo-int-proc">
                    {i.numeroProcesso || 'Processo não identificado'}
                    {i.nomeClasse && <span className="prazo-int-classe"> · {i.nomeClasse}</span>}
                  </div>
                  {g.ids.length > 1 && pubsAbertas === i.id && (
                    <ul className="prazo-int-pubs">
                      {g.membros.map((pub, idx) => (
                        <li key={pub.id} className="prazo-int-pub">
                          <span className="prazo-int-pub-n">{idx + 1}.</span>
                          <span className="prazo-int-pub-dest">
                            {pub.orgao || pub.advogadoNome || 'destinatário não identificado'}
                            {pub.oabConsulta && <span className="prazo-int-pub-oab"> · OAB {pub.oabConsulta}</span>}
                          </span>
                          {(pub.hash || pub.link) && (
                            <a
                              className="prazo-int-pub-link"
                              href={pub.hash ? `${API_DJEN}/${pub.hash}/certidao` : pub.link!}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Certidão desta publicação (PDF)"
                            >
                              <ExternalLink size={12} /> certidão
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {i.texto && (
                    <div className={`prazo-int-texto ${expandedId === i.id ? 'prazo-int-texto--full' : ''}`}>
                      {i.texto}
                    </div>
                  )}
                  {i.texto && i.texto.length > 180 && (
                    <button className="prazo-int-expand" onClick={() => setExpandedId(expandedId === i.id ? null : i.id)}>
                      {expandedId === i.id ? 'ocultar teor' : 'ver teor completo'}
                    </button>
                  )}
                  {intFilter === 'GERADA' && (i.prazo ? (
                    <div className={`prazo-int-vinculo ${i.prazo.status === 'CUMPRIDO' ? 'prazo-int-vinculo--done' : ''}`}>
                      {i.prazo.status === 'CUMPRIDO' ? <Check size={13} /> : <CalendarClock size={13} />}
                      <span className="prazo-int-vinculo-titulo">{i.prazo.title}</span>
                      <span className="prazo-int-vinculo-fatal">fatal {formatDate(i.prazo.fatalDate)}</span>
                      <span className="prazo-int-vinculo-status">{i.prazo.status === 'CUMPRIDO' ? 'CUMPRIDO' : 'PENDENTE'}</span>
                    </div>
                  ) : (
                    <div className="prazo-int-vinculo prazo-int-vinculo--orfao">
                      <X size={13} />
                      <span>O prazo vinculado foi excluído do quadro.</span>
                    </div>
                  ))}
                  <div className="prazo-int-footer">
                    {i.revisadoPor && <span className="prazo-int-revisado">revisado por {i.revisadoPor}</span>}
                    <div className="prazo-int-actions">
                      {intFilter === 'GERADA' && !i.prazo && (
                        <button className="lx-btn-tool" onClick={() => restaurarIntimacao(g)}>
                          <RotateCcw size={14} /> Voltar para Novas
                        </button>
                      )}
                      {intFilter === 'GERADA' && i.prazo && (
                        <>
                          <button className="lx-btn-tool" onClick={() => setView('board')}>
                            <ArrowLeft size={14} /> Ver no quadro
                          </button>
                          {i.prazo.status !== 'CUMPRIDO' && (
                            <button
                              className="lx-btn-primary prazo-int-gerar"
                              onClick={() => { setMoverName(defaultMover); setMoveModal({ prazo: i.prazo!, targetStatus: 'CUMPRIDO' }); }}
                            >
                              <Check size={15} /> Concluir prazo
                            </button>
                          )}
                        </>
                      )}
                      {intFilter === 'NOVA' && (
                        <>
                          <button className="lx-btn-tool" onClick={() => descartarIntimacao(g)}>
                            <Trash2 size={14} /> Descartar
                          </button>
                          <button className="lx-btn-primary prazo-int-gerar" onClick={() => abrirGerarPrazo(g)}>
                            <CalendarClock size={15} /> Gerar prazo
                          </button>
                        </>
                      )}
                      {intFilter === 'DESCARTADA' && (
                        <button className="lx-btn-tool" onClick={() => restaurarIntimacao(g)}>
                          <RotateCcw size={14} /> Restaurar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                        );
                      })}
                      {!colAberta && colGrupos.length > INT_CARDS_VISIVEIS && (
                        <button
                          type="button"
                          className="prazo-col-vermais"
                          onClick={() => setColAberta(col.key)}
                        >
                          Ver todos ({colGrupos.length})
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="prazo-loading"><Loader2 className="lx-spin" size={32} /></div>
      ) : totalPrazos === 0 ? (
        <div className="prazo-empty-all">
          <CalendarClock size={48} className="prazo-empty-icon" />
          <h3>Quadro em dia</h3>
          <p>
            Nenhum prazo ativo no momento.
            {intCounts.nova > 0 && (intCounts.nova === 1
              ? ' 1 intimação nova aguarda triagem na caixa.'
              : ` ${intCounts.nova} intimações novas aguardam triagem na caixa.`)}
          </p>
          <div className="prazo-empty-actions">
            {intCounts.nova > 0 && (
              <button className="lx-btn-primary" onClick={() => setView('inbox')}>
                <Inbox size={16} /> Abrir caixa de intimações
              </button>
            )}
            <button className="lx-btn-tool" onClick={abrirNovo}><Plus size={16} /> Novo prazo</button>
            <button className="lx-btn-tool" onClick={() => setImportOpen(true)}><Upload size={16} /> Importar planilha</button>
          </div>
        </div>
      ) : (
        <>
        {count('hoje') + count('semana') === 0 && (
          <p className="prazo-nada-hoje">Nada vence hoje nem nesta semana.</p>
        )}
        <div className="prazo-board">
          {COLUMNS.map(col => {
            const items = groups[col.key] || [];
            const expandida = !!boardExpandidas[col.key];
            const visiveis = expandida ? items : items.slice(0, PRAZO_CARDS_VISIVEIS);
            return (
              <div
                key={col.key}
                // "Concluído" nunca encolhe: é o alvo de soltar do arrastar-e-soltar.
                className={`prazo-col ${col.cls} ${items.length === 0 && col.key !== 'concluido' ? 'prazo-col--vazia' : ''} ${dragOverCol === col.key ? 'prazo-col--dragover' : ''}`}
                onDragOver={e => onColDragOver(e, col.key)}
                onDragLeave={onColDragLeave}
                onDrop={() => onColDrop(col.key)}
              >
                <div className="prazo-col-header">
                  <span className="prazo-col-title">{col.label}</span>
                  <span className="prazo-col-count">{items.length}</span>
                </div>
                <div className="prazo-col-body">
                  {items.length === 0 ? (
                    <div className="prazo-col-empty">{col.key === 'concluido' ? 'Arraste um card aqui para concluir' : 'Nenhum'}</div>
                  ) : visiveis.map(p => (
                    <div
                      key={p.id}
                      className={`prazo-card ${col.key === 'concluido' ? 'prazo-card--done' : ''}`}
                      draggable
                      onDragStart={() => onDragStart(p)}
                    >
                      <div className="prazo-card-top">
                        <div className="prazo-card-actions">
                          <button className="prazo-icon-btn" title="Editar" onClick={() => abrirEdicao(p)}><Pencil size={14} /></button>
                          <button className="prazo-icon-btn prazo-icon-btn--danger" title="Excluir" onClick={() => excluir(p)}><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <div className="prazo-card-title">{p.title}</div>
                      {p.caseReference && <div className="prazo-card-case">{p.caseReference}</div>}
                      <div className="prazo-card-meta">
                        <CalendarClock size={13} />
                        <span>fatal {formatDate(p.fatalDate)}</span>
                        {col.key !== 'concluido' && (
                          <span className={`prazo-card-rel prazo-card-rel--${col.key}`}>· {relativeLabel(p.daysUntilFatal)}</span>
                        )}
                      </div>
                      {p.responsibleName && <div className="prazo-card-resp">{p.responsibleName}</div>}
                      {p.lastMovedBy && (
                        <div className="prazo-card-moved">
                          <History size={11} /> movido por {p.lastMovedBy}
                          {p.lastMovedAt && ` · ${formatDate(p.lastMovedAt)}`}
                        </div>
                      )}
                    </div>
                  ))}
                  {items.length > PRAZO_CARDS_VISIVEIS && (
                    <button
                      type="button"
                      className="prazo-col-vermais"
                      onClick={() => setBoardExpandidas(prev => ({ ...prev, [col.key]: !expandida }))}
                    >
                      {expandida ? 'Ver menos' : `Ver mais ${items.length - PRAZO_CARDS_VISIVEIS}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

      {/* Modal criar / editar / gerar de intimação */}
      {modalOpen && (
        <div className="prazo-modal-overlay" onClick={() => { if (!saving) { setModalOpen(false); setGerandoDe(null); } }}>
          <div className="prazo-modal" onClick={e => e.stopPropagation()}>
            <div className="prazo-modal-header">
              <h3>{gerandoDe ? 'Gerar prazo da intimação' : editingId ? 'Editar Prazo' : 'Novo Prazo'}</h3>
              <button className="prazo-icon-btn" title="Fechar" onClick={() => { setModalOpen(false); setGerandoDe(null); }}><X size={18} /></button>
            </div>
            {gerandoDe && (
              <p className="prazo-gerar-origem">
                Confira os dados e defina a <strong>data fatal</strong> — {gerandoDe.int.tribunal} · disponibilizada em {gerandoDe.int.dataDisponibilizacao ? formatDate(gerandoDe.int.dataDisponibilizacao) : '—'}
                {gerandoDe.grupoIds.length > 0 && ` · ${gerandoDe.grupoIds.length + 1} publicações do mesmo ato serão marcadas juntas`}
              </p>
            )}
            <div className="prazo-form">
              <div className="prazo-field">
                <label htmlFor="prazo-title">Título *</label>
                <input id="prazo-title" type="text" value={form.title} placeholder="Ex: Contestação, Recurso de Apelação..."
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="prazo-field">
                <label htmlFor="prazo-case">Processo / Cliente</label>
                <input id="prazo-case" type="text" value={form.caseReference} placeholder="Ex: Silva vs Banco X"
                  onChange={e => setForm(f => ({ ...f, caseReference: e.target.value }))} />
              </div>
              <div className="prazo-field">
                <label htmlFor="prazo-resp">Responsável</label>
                <input id="prazo-resp" type="text" value={form.responsibleName} placeholder="Ex: Dr. Ana"
                  onChange={e => setForm(f => ({ ...f, responsibleName: e.target.value }))} />
              </div>
              <div className="prazo-field">
                <label htmlFor="prazo-type">Tipo</label>
                <select id="prazo-type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {TYPES.map(t => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
                </select>
              </div>
              <div className="prazo-field-row">
                <div className="prazo-field">
                  <label htmlFor="prazo-fatal">Data fatal *</label>
                  <input id="prazo-fatal" type="date" value={form.fatalDate}
                    onChange={e => setForm(f => ({ ...f, fatalDate: e.target.value }))} />
                </div>
                <div className="prazo-field">
                  <label htmlFor="prazo-internal">Prazo interno (opcional)</label>
                  <input id="prazo-internal" type="date" value={form.internalDate}
                    onChange={e => setForm(f => ({ ...f, internalDate: e.target.value }))} />
                </div>
              </div>
              <div className="prazo-field">
                <label htmlFor="prazo-desc">Observações (opcional)</label>
                <textarea id="prazo-desc" rows={3} value={form.description} placeholder="Detalhes, número do processo completo, etc."
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="prazo-modal-footer">
              <button className="lx-btn-tool" onClick={() => { setModalOpen(false); setGerandoDe(null); }} disabled={saving}>Cancelar</button>
              <button className="lx-btn-primary" onClick={salvar} disabled={saving}>
                {saving ? <Loader2 className="lx-spin" size={16} /> : <Check size={16} />}
                {gerandoDe ? 'Gerar prazo' : editingId ? 'Salvar alterações' : 'Criar prazo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt: quem movimentou */}
      {moveModal && (
        <div className="prazo-modal-overlay" onClick={() => setMoveModal(null)}>
          <div className="prazo-modal prazo-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="prazo-modal-header">
              <h3>{moveModal.targetStatus === 'CUMPRIDO' ? 'Concluir prazo' : 'Reabrir prazo'}</h3>
              <button className="prazo-icon-btn" title="Fechar" onClick={() => setMoveModal(null)}><X size={18} /></button>
            </div>
            <div className="prazo-form">
              <p className="prazo-move-desc">
                <strong>{moveModal.prazo.title}</strong>
                {moveModal.prazo.caseReference && ` · ${moveModal.prazo.caseReference}`}
              </p>
              <div className="prazo-field">
                <label htmlFor="prazo-mover">Quem está movimentando? *</label>
                <input id="prazo-mover" type="text" value={moverName} autoFocus placeholder="Seu nome"
                  onChange={e => setMoverName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && moverName.trim()) confirmarMovimentacao(); }} />
              </div>
            </div>
            <div className="prazo-modal-footer">
              <button className="lx-btn-tool" onClick={() => setMoveModal(null)}>Cancelar</button>
              <button className="lx-btn-primary" onClick={confirmarMovimentacao} disabled={!moverName.trim()}>
                <Check size={16} /> Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de importação */}
      {importOpen && (
        <div className="prazo-modal-overlay" onClick={() => !importing && setImportOpen(false)}>
          <div className="prazo-modal prazo-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="prazo-modal-header">
              <h3>Importar planilha</h3>
              <button className="prazo-icon-btn" title="Fechar" onClick={() => setImportOpen(false)}><X size={18} /></button>
            </div>
            <div className="prazo-form">
              <p className="prazo-import-step"><strong>1.</strong> Baixe o modelo e cole seus dados nas colunas indicadas.</p>
              <button className="lx-btn-tool prazo-import-tpl" onClick={baixarModelo}>
                <Download size={16} /> Baixar modelo (.xlsx)
              </button>
              <p className="prazo-import-step"><strong>2.</strong> Suba a planilha preenchida (.xlsx ou .csv).</p>
              <button className="lx-btn-primary prazo-import-up" onClick={() => importInputRef.current?.click()} disabled={importing}>
                {importing ? <Loader2 className="lx-spin" size={16} /> : <Upload size={16} />}
                {importing ? 'Importando...' : 'Escolher arquivo e importar'}
              </button>
              <input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" className="prazo-hidden-input"
                title="Planilha de prazos"
                onChange={e => { if (e.target.files?.[0]) onImportFile(e.target.files[0]); }} />
              <p className="prazo-import-hint">Colunas: Título, Processo/Cliente, Responsável, Tipo, Data Fatal, Prazo Interno, Observações. Só Título e Data Fatal são obrigatórios.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
