import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Plus, Check, Trash2, X, CalendarClock, Loader2, Upload, Download,
  Inbox, RefreshCw, ExternalLink, ChevronLeft, ChevronRight, Search,
  ChevronDown, Users, MoreHorizontal, SlidersHorizontal,
} from 'lucide-react';
import './PrazosTab.css';
import { apiFetch, API } from './firebase';

const API_DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
// `link` vem da API do DJEN: só vira href se for http(s) (nada de javascript:).
const linkSeguro = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);

const TYPES = ['JUDICIAL', 'ADMINISTRATIVO', 'INTERNO'];

const COLUMNS = [
  // Card que o tribunal mandou sem data fatal (DJEN sem par no PJe, pauta, "sem prazo"):
  // quem assume abre o card e informa a data; aí ele entra nas colunas de urgência.
  { key: 'triagem', label: 'A confirmar', cls: 'prazo-col--triagem', empty: 'Nada a confirmar' },
  { key: 'vencido', label: 'Vencidos', cls: 'prazo-col--vencido', empty: 'Nenhum vencido' },
  { key: 'hoje', label: 'Hoje', cls: 'prazo-col--hoje', empty: 'Nada para hoje' },
  { key: 'semana', label: 'Esta semana', cls: 'prazo-col--semana', empty: 'Nada nesta semana' },
  { key: 'futuro', label: 'Futuro', cls: 'prazo-col--futuro', empty: 'Nenhum agendado' },
  { key: 'concluido', label: 'Concluído', cls: 'prazo-col--concluido', empty: 'Arraste um card aqui para concluir' },
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
  responsibleId?: string | null;
  caseReference?: string | null;
  lastMovedBy?: string | null;
  lastMovedAt?: string | null;
  daysUntilFatal: number;
  bucket: string;
  prioridade?: string | null;
  // intimação de origem (quando o prazo nasceu da caixa)
  intimacoes?: { tribunal?: string | null; tipoDocumento?: string | null; tipoComunicacao?: string | null; nomeClasse?: string | null; orgao?: string | null }[];
  // Prazo criado pelo robô do PJe: tribunal/órgão do expediente (quando não há intimação ligada)
  origemPje?: ({ tribunal: string; orgao?: string | null; tipo?: string | null } & CaminhoPje) | null;
}

// Onde o expediente estava no Painel do Advogado: aba › jurisdição › caixa
type CaminhoPje = { situacao?: string | null; jurisdicao?: string | null; caixa?: string | null };
export function caminhoPje(c?: CaminhoPje | null): string | null {
  if (!c?.situacao) return null;
  return [c.situacao, c.jurisdicao, c.caixa || 'Caixa de entrada'].filter(Boolean).join(' › ');
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
  // Expediente do Painel do Advogado (robô com certificado): prazo e data limite calculados pelo PRÓPRIO PJe
  expedientePje?: {
    tribunal: string;
    idExpediente: string;
    prazoDias: number | null;
    cienciaPendente: boolean;
    dataCiencia: string | null;
    dataLimite: string | null;
  } & CaminhoPje | null;
  // O processo já tem prazo criado pelo robô do PJe no quadro (possível duplicidade)
}

// Resumo do prazo gerado a partir da intimação (aba "Distribuídas")
type PrazoVinculado = Pick<Prazo, 'id' | 'title' | 'status' | 'fatalDate'> & { caseReference?: string | null };


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

// Helpers do filtro de mês da caixa ('YYYY-MM')
export function mesAtual(): string {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7); // sv-SE = AAAA-MM-DD
}

export function nomeMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Classifica pelo tipoDocumento do DJEN. Substrings escolhidas sem acento de
// propósito ("senten" pega Sentença; "decis" pega Decisão e suspensão;
// "intima" pega Intimação e pauta) — dispensa normalização de diacríticos.
export function tipoBucket(i: Pick<Intimacao, 'tipoDocumento' | 'tipoComunicacao'>): IntColKey {
  const t = (i.tipoDocumento || i.tipoComunicacao || '').toLowerCase();
  if (t.includes('senten')) return 'sentenca';
  if (t.includes('decis')) return 'decisao';
  if (t.includes('despacho')) return 'despacho';
  if (t.includes('intima') || t.includes('notifica')) return 'intimacao';
  return 'outros';
}

// Chaves espelhadas em AREAS_VALIDAS (backend/src/routes/userRoutes.js) — mudou aqui, muda lá.
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

// Órgão julgador como chave de filtro: ignora caixa e espaços duplicados ('SEM' se vazio)
function chaveOrgao(s?: string | null): string {
  return (s || '').trim().replace(/\s+/g, ' ').toUpperCase() || 'SEM';
}

// Tribunal de uma intimação como chave de filtro ('SEM' quando o DJEN não informa)
function chaveTribunal(t?: string | null): string {
  return (t || '').trim().toUpperCase() || 'SEM';
}

// Tribunais presentes no recorte, do mais frequente ao menos (empate: alfabética).
// Lista dinâmica: tribunal novo (TJBA, TST...) aparece sozinho.
export function tribunaisPresentes(tribunais: (string | null | undefined)[]) {
  const n = new Map<string, number>();
  tribunais.forEach(t => { const k = chaveTribunal(t); n.set(k, (n.get(k) || 0) + 1); });
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, qtd]) => ({ key, label: key === 'SEM' ? 'Sem tribunal' : key, n: qtd }));
}

// Banco como PARTE: rótulo de polo seguido de nome de banco, no cabeçalho do teor.
// Banco só citado no corpo ("depósito no Banco do Brasil") não casa.
const BANCO_PARTE = /\b(?:REQUERID|REQUERENTE|EXECUTAD|EXEQUENTE|R[ÉE]U|AUTOR|APELAD|APELANTE|RECORRID|RECORRENTE|EMBARGAD|EMBARGANTE|AGRAVAD|AGRAVANTE|RECLAMAD|IMPETRAD|POLO ATIVO|POLO PASSIVO)[A-Z()]*\s*[:-]\s*(?:BANCO|CAIXA ECON[ÔO]MICA|ITA[ÚU]|BRADESCO|SANTANDER|AGIBANK|BMG|CREFISA|NUBANK|SICREDI|SICOOB|AYMOR[ÉE])/;

export function areaDireito(i: Pick<Intimacao, 'nomeClasse' | 'orgao' | 'tribunal' | 'texto'>): AreaKey {
  const classe = (i.nomeClasse || '').toUpperCase();
  const org = (i.orgao || '').toUpperCase();
  const trib = (i.tribunal || '').toUpperCase();
  if (!classe && !org && !trib) return 'outras';
  if (trib.startsWith('TRT') || classe.includes('TRABALH') || org.includes('TRABALH')) return 'trabalhista';
  // ponytail: só o início do teor — as partes vêm no topo e o teor inteiro pode ter vários KB
  const cabecalho = (i.texto || '').slice(0, 2000).toUpperCase();
  if (classe.includes('BANC') || org.includes('BANC') || BANCO_PARTE.test(cabecalho)) return 'bancario';
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

// Nomes e classes chegam do DJEN em CAIXA ALTA; exibimos em capitalização de
// nome próprio (partículas em minúsculas). Não usar em órgão/tribunal — siglas
// como TJMT virariam "Tjmt".
const PARTICULAS = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
export function nomeProprio(s?: string | null): string {
  return String(s || '')
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && PARTICULAS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const PRIORIDADES = [
  { key: 'ALTA', label: 'Alta' },
  { key: 'MEDIA', label: 'Média' },
  { key: 'BAIXA', label: 'Baixa' },
] as const;

// Alta → Média → Baixa → sem prioridade; dentro de cada faixa mantém a ordem recebida (prazo limite).
export function ordenarPorPrioridade<T extends { prioridade?: string | null }>(ps: T[]): T[] {
  const rank = (p: T) => { const i = PRIORIDADES.findIndex(x => x.key === p.prioridade); return i < 0 ? PRIORIDADES.length : i; };
  return [...ps].sort((a, b) => rank(a) - rank(b));
}

// "Mariana Rocha" → "MR"; "joao@x.com" → "J". Partículas (da, de...) não contam.
export function iniciais(nome?: string | null): string {
  const p = String(nome || '').trim().split(/\s+/).filter(w => w && !PARTICULAS.has(w.toLowerCase()));
  if (!p.length) return '?';
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

// Carga de cada pessoa (prazos abertos e vencidos), para escolher para quem enviar.
export function cargaPorPessoa(prazos: Pick<Prazo, 'responsibleId' | 'bucket'>[]) {
  const m = new Map<string, { abertos: number; vencidos: number }>();
  prazos.forEach(p => {
    if (!p.responsibleId || p.bucket === 'concluido') return;
    const c = m.get(p.responsibleId) || { abertos: 0, vencidos: 0 };
    c.abertos++;
    if (p.bucket === 'vencido') c.vencidos++;
    m.set(p.responsibleId, c);
  });
  return m;
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

type Membro = { id: string; name?: string | null; email: string; noQuadro?: boolean };

const emptyForm = {
  title: '', caseReference: '', responsibleName: '', responsibleId: '',
  type: 'JUDICIAL', prioridade: '', fatalDate: '', internalDate: '', description: '',
};

// Tipo/área/tribunal/órgão de um card vêm da intimação ligada ou, nos prazos do robô, do expediente do PJe.
const origemDe = (p: Pick<Prazo, 'intimacoes' | 'origemPje'>) => {
  const o = p.intimacoes?.[0];
  return {
    tribunal: o?.tribunal || p.origemPje?.tribunal,
    orgao: o?.orgao || p.origemPje?.orgao,
    classe: o?.nomeClasse,
    tipo: o?.tipoDocumento || o?.tipoComunicacao || p.origemPje?.tipo,
  };
};

// ponytail: sem o teor (pesado para o quadro inteiro) — banco como parte só é detectado pela classe/órgão
export function areaDoPrazo(p: Pick<Prazo, 'intimacoes' | 'origemPje'>): AreaKey {
  const o = origemDe(p);
  return areaDireito({ nomeClasse: o.classe, orgao: o.orgao, tribunal: o.tribunal, texto: '' });
}

/** Card sem dono que cabe a mim triar: sem responsável, aberto e da minha área (sem área cadastrada, vê todos). */
export function cardSemDono(
  p: Pick<Prazo, 'responsibleId' | 'responsibleName' | 'bucket' | 'intimacoes' | 'origemPje'>,
  minhasAreas: readonly AreaKey[],
): boolean {
  if (p.responsibleId || p.responsibleName || p.bucket === 'concluido') return false;
  return !minhasAreas.length || minhasAreas.includes(areaDoPrazo(p));
}

/** Card "a confirmar": quanto tempo está parado sem data fatal (days = dias desde a publicação, negativo). */
export function rotuloTriagem(days: number): string {
  const parado = -days;
  return parado >= 2 ? `sem data há ${parado} dias` : 'sem data fatal';
}

export function relativeLabel(days: number): string {
  // ponytail: mais de 10 anos é ano digitado errado na planilha, não prazo.
  // Prefiro admitir que a data é suspeita a imprimir "em 138583 dias" com cara de certeza.
  if (Math.abs(days) > 3650) return 'data suspeita';
  if (days < 0) return `atrasado ${Math.abs(days)} dia${Math.abs(days) > 1 ? 's' : ''}`;
  if (days === 0) return 'vence hoje';
  if (days === 1) return 'vence amanhã';
  return `em ${days} dias`;
}

// Data gravada → "AAAA-MM-DD" do input date, no fuso LOCAL (o backend grava meia-noite
// local; toISOString() é UTC e devolvia o dia anterior em qualquer fuso a oeste de Greenwich)
function dataLocal(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE');
}

function formatDate(iso: string): string {
  // Ano com 4 dígitos: com 2 dígitos, o ano 2406 aparecia como "05" e escondia o erro.
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function PrazosTab({ currentUser, dbUser, showToast, initialView = 'board' }: PrazosTabProps) {
  const [todosGroups, setGroups] = useState<Groups>({ vencido: [], hoje: [], semana: [], futuro: [], concluido: [] });
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  // Drag-and-drop
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const dragged = useRef<{ prazo: Prazo; isDone: boolean } | null>(null);
  // Cards visíveis por coluna (caixa e quadro); "Mostrar mais" soma uma página
  const [limites, setLimites] = useState<Record<string, number>>({});

  // Confirmação de movimentação (aceita o prazo do quadro ou o vinculado a uma intimação).
  // Quem moveu é sempre o usuário logado — o backend ignora qualquer nome digitado.
  const [moveModal, setMoveModal] = useState<{ prazo: Pick<Prazo, 'id' | 'title'> & { caseReference?: string | null }; targetStatus: string } | null>(null);

  // Importação
  const [importOpen, setImportOpen] = useState(false);

  // Perfis do quadro "Por pessoa" (só admin gerencia)
  const [perfisOpen, setPerfisOpen] = useState(false);
  const [novoPerfil, setNovoPerfil] = useState({ name: '', email: '' });
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const isAdmin = dbUser?.role === 'admin';
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Caixa de entrada de intimações (DJEN). Monta na view pedida pelo dashboard.
  const [view, setView] = useState<'board' | 'inbox'>(initialView);
  const [intimacoes, setIntimacoes] = useState<Intimacao[]>([]);
  // Mês exibido na caixa ('' = todos). Abre no mês vigente.
  const [intMes, setIntMes] = useState<string>(mesAtual);

  const mudarMes = (delta: number) => {
    const [y, m] = (intMes || mesAtual()).split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setIntMes(d.toLocaleDateString('sv-SE').slice(0, 7)); // sv-SE = AAAA-MM-DD
  };
  const [intLoading, setIntLoading] = useState(true);
  // Nº da última requisição da caixa: resposta atrasada de um mês anterior não sobrescreve a atual
  const intReq = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [syncingPje, setSyncingPje] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pubsAbertas, setPubsAbertas] = useState<string | null>(null);
  // Filtro por área do direito na caixa ('' = todas; 'minhas' = áreas do usuário)
  const [intArea, setIntArea] = useState<AreaKey | '' | 'minhas'>('');
  // Filtro por tribunal na caixa ('' = todos; chave de chaveTribunal)
  const [intTribunal, setIntTribunal] = useState('');
  const [intOrgao, setIntOrgao] = useState('');
  // Busca por número do processo ou cliente
  const [intBusca, setIntBusca] = useState('');
  // Distribuídas: abre só nas que viraram card "A confirmar" (sem data fatal)
  const [intSemData, setIntSemData] = useState(true);

  // Distribuição por área: cada pessoa tria as próprias áreas e fica com os prazos que gera
  const minhasAreas: AreaKey[] = dbUser?.areas || [];
  // Recorte do quadro: meus cards | sem dono (das minhas áreas) | todos
  const [recorte, setRecorte] = useState<'meus' | 'semDono' | 'todos'>('todos');
  const [equipe, setEquipe] = useState<Membro[]>([]);

  // Quadro: colunas por pessoa (distribuição) ou por urgência
  // "Enviar para": intimação com o seletor aberto, pessoa e prazo limite escolhidos
  // Menu aberto: ⋯ de um card (id da intimação), 'lote' ou 'quadro'
  const [menu, setMenu] = useState<string | null>(null);
  // Quadro: busca e filtro de prioridade
  const [buscaQuadro, setBuscaQuadro] = useState('');
  // Filtros do quadro (aba "Filtros"): chave do filtro → valor escolhido ('' = todos)
  const [filtrosQuadro, setFiltrosQuadro] = useState<Record<string, string>>({});

  // Fecha menus ao clicar fora
  useEffect(() => {
    if (!menu) return;
    const fechar = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.prazo-menu-wrap')) setMenu(null); };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [menu]);

  const defaultMover = dbUser?.name || currentUser?.displayName || currentUser?.email || '';

  // Quem participa da distribuição abre no próprio recorte (caixa e quadro).
  // Roda quando o usuário carrega, que pode ser depois do mount.
  useEffect(() => {
    if (dbUser?.areas?.length) { setIntArea('minhas'); setRecorte('meus'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbUser?.id]);

  // Equipe para o seletor de responsável (quem já entrou uma vez no sistema)
  useEffect(() => {
    apiFetch(`${API}/api/users`)
      .then(r => r.json())
      .then(d => { if (d.success) setEquipe(d.users); })
      .catch(() => { /* seletor cai para só o usuário logado */ });
  }, [currentUser?.email]);


  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/api/prazos`);
      const d = await r.json();
      if (d.success) {
        const g: Groups = { triagem: [], vencido: [], hoje: [], semana: [], futuro: [], concluido: [] };
        // vencidoAntigo (vencido há mais de 2 dias) não entra em coluna nenhuma: sai do quadro
        (d.prazos as Prazo[]).forEach(p => { if (p.bucket !== 'vencidoAntigo') (g[p.bucket] || g.futuro).push(p); });
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

  const carregarIntimacoes = useCallback(async () => {
    const seq = ++intReq.current;
    setIntLoading(true);
    try {
      const r = await apiFetch(`${API}/api/intimacoes${intMes ? `?mes=${intMes}` : ''}`);
      const d = await r.json();
      if (seq !== intReq.current) return; // já pediram outro mês/filtro depois desta
      if (d.success) {
        setIntimacoes(d.intimacoes);
      }
    } catch {
      if (seq === intReq.current) showToast('Erro ao carregar intimações.', 'error');
    } finally {
      if (seq === intReq.current) setIntLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.email, intMes]);

  useEffect(() => { carregarIntimacoes(); }, [carregarIntimacoes]);

  const sincronizarDjen = async () => {
    setSyncing(true);
    try {
      const r = await apiFetch(`${API}/api/intimacoes/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (d.success) {
        const erros = d.erros?.length ? ` · API instável em parte da busca` : '';
        const novosCards = (d.quadro?.criados || 0) + (d.quadro?.djen || 0);
        const msg = d.criadas > 0
          ? `${d.criadas} nova(s) intimação(ões) · ${novosCards} card(s) novo(s) no quadro${erros}`
          : `Nada novo no DJEN desde a última busca. O que chegou hoje já está no quadro.${erros}`;
        showToast(msg, d.criadas > 0 ? 'success' : 'info');
        carregarIntimacoes();
        carregar(); // o quadro pode ter ganhado cards
      } else {
        showToast(d.error || 'Falha ao consultar o DJEN.', 'error');
      }
    } catch {
      showToast('Erro de conexão com o DJEN.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  // Lê o Painel do Advogado (certificado A1) e traz prazos/datas limite oficiais do PJe
  const sincronizarPje = async () => {
    setSyncingPje(true);
    try {
      const r = await apiFetch(`${API}/api/intimacoes/sync-pje`, { method: 'POST' });
      const d = await r.json();
      if (d.success) {
        const ok = d.resultado.filter((t: any) => !t.erro);
        const falhas = d.resultado.filter((t: any) => t.erro).map((t: any) => t.tribunal);
        showToast(
          `${ok.map((t: any) => `${t.tribunal}: ${t.expedientes}`).join(' · ') || 'Nenhum tribunal respondeu'}`
            + ` · ${d.prazos?.criados ?? 0} prazo(s) novo(s) no quadro`
            + `${falhas.length ? ` · falhou: ${falhas.join(', ')}` : ''}`,
          falhas.length ? 'error' : 'success',
        );
        carregarIntimacoes();
        carregar();
      } else {
        showToast(d.error || 'Falha ao ler o PJe.', 'error');
      }
    } catch {
      showToast('Erro de conexão ao ler o PJe.', 'error');
    } finally {
      setSyncingPje(false);
    }
  };

  const marcarNoQuadro = async (u: Membro, noQuadro: boolean) => {
    try {
      const r = await apiFetch(`${API}/api/users/${u.id}/quadro`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noQuadro }),
      });
      const d = await r.json();
      if (d.success) setEquipe(eq => eq.map(x => x.id === u.id ? { ...x, noQuadro } : x));
      else showToast(d.error || 'Erro ao atualizar o quadro.', 'error');
    } catch { showToast('Erro de conexão.', 'error'); }
  };

  const adicionarPerfil = async () => {
    setSalvandoPerfil(true);
    try {
      const r = await apiFetch(`${API}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(novoPerfil),
      });
      const d = await r.json();
      if (d.success) {
        setEquipe(eq => [...eq.filter(x => x.id !== d.user.id), d.user].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)));
        setNovoPerfil({ name: '', email: '' });
        showToast(`${d.user.name || d.user.email} está no quadro.`, 'success');
      } else {
        showToast(d.error || 'Erro ao cadastrar.', 'error');
      }
    } catch {
      showToast('Erro de conexão.', 'error');
    } finally {
      setSalvandoPerfil(false);
    }
  };

  const abrirNovo = () => {
    setEditingId(null);
    setForm({ ...emptyForm, responsibleName: defaultMover, responsibleId: dbUser?.id || '' });
    setModalOpen(true);
  };

  const abrirEdicao = (p: Prazo) => {
    setEditingId(p.id);
    setForm({
      title: p.title || '', caseReference: p.caseReference || '',
      responsibleName: p.responsibleName || '', responsibleId: p.responsibleId || '',
      type: p.type || 'JUDICIAL',
      prioridade: p.prioridade || '',
      fatalDate: p.fatalDate ? dataLocal(p.fatalDate) : '',
      internalDate: p.internalDate ? dataLocal(p.internalDate) : '',
      description: p.description || '',
    });
    setModalOpen(true);
  };

  const salvar = async () => {
    if (!form.title.trim() || !form.fatalDate) {
      showToast('Preencha ao menos o título e o prazo limite.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        caseReference: form.caseReference.trim() || null,
        responsibleName: form.responsibleName.trim() || null,
        responsibleId: form.responsibleId || null,
        type: form.type,
        prioridade: form.prioridade || null,
        fatalDate: form.fatalDate, internalDate: form.internalDate || null,
        description: form.description.trim() || null,
      };
      const url = editingId ? `${API}/api/prazos/${editingId}` : `${API}/api/prazos`;
      const r = await apiFetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (d.success) {
        setModalOpen(false);
        showToast(editingId ? 'Prazo atualizado!' : 'Prazo criado!', 'success');
        carregar();
      } else {
        // 400 vem com `details` (ex.: "internalDate não pode ser posterior a fatalDate") — é o que o usuário precisa ler
        showToast(d.details?.join(' · ') || d.error || 'Erro ao salvar prazo.', 'error');
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
        const r = await apiFetch(`${API}/api/prazos/${p.id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error); // sucesso é 204 sem corpo
        setModalOpen(false);
        showToast('Prazo excluído.', 'info');
        carregar();
      } catch (e) { showToast((e as Error).message || 'Erro ao excluir.', 'error'); }
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
    setMoveModal({ prazo: d.prazo, targetStatus });
  };

  const confirmarMovimentacao = async () => {
    if (!moveModal) return;
    try {
      const r = await apiFetch(`${API}/api/prazos/${moveModal.prazo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // lastMovedBy preenchido = "foi um arraste"; o backend grava o usuário autenticado
        body: JSON.stringify({ status: moveModal.targetStatus, lastMovedBy: defaultMover || 'x' }),
      });
      const d = await r.json();
      if (d.success) {
        showToast(moveModal.targetStatus === 'CUMPRIDO' ? 'Prazo concluído!' : 'Prazo reaberto!', 'success');
        setMoveModal(null);
        carregar();
        if (view === 'inbox') carregarIntimacoes(); // atualiza o chip do prazo vinculado
      } else {
        showToast('Erro ao mover prazo.', 'error');
      }
    } catch {
      showToast('Erro de conexão.', 'error');
    }
  };

  // "Pegar": assume o card e os demais sem dono do mesmo processo (rota /pegar)
  const pegar = async (p: Prazo) => {
    try {
      const r = await apiFetch(`${API}/api/prazos/${p.id}/pegar`, { method: 'PATCH' });
      const d = await r.json();
      if (d.success) {
        showToast(d.assumidos > 1 ? `Você assumiu ${d.assumidos} cards do processo ${d.processo}.` : 'Card no seu nome.', 'success');
        carregar();
      } else {
        showToast(d.error || 'Erro ao assumir o card.', 'error');
        carregar(); // 409: alguém pegou antes — mostra o dono atual
      }
    } catch { showToast('Erro de conexão.', 'error'); }
  };

  // ── Importação ───────────────────────────────────────────────────
  const baixarModelo = async () => {
    try {
      const r = await apiFetch(`${API}/api/prazos/template`);
      if (!r.ok) throw new Error(); // senão o JSON de erro viraria um .xlsx corrompido
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
      const r = await apiFetch(`${API}/api/prazos/import`, { method: 'POST', body: fd });
      const d = await r.json();
      if (d.success) {
        const ign = d.ignoredNoDate ? ` · ${d.ignoredNoDate} sem data/título ignorada(s)` : '';
        const falhas = d.errors?.length ? ` · ${d.errors.length} linha(s) com erro: ${d.errors.slice(0, 2).join('; ')}` : '';
        showToast(`${d.imported} prazo(s) importado(s)!${ign}${falhas}`, falhas ? 'error' : d.imported > 0 ? 'success' : 'info');
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

  // Recorte: colunas, contagens e resumo do cabeçalho seguem o recorte
  // (na visão por pessoa o recorte não se aplica: cada coluna já é uma pessoa)
  const recorteDe = (p: Prazo, r = recorte) =>
    (r === 'meus' ? p.responsibleId === dbUser?.id : r === 'semDono' ? cardSemDono(p, minhasAreas) : true);
  const groups: Groups = recorte !== 'todos' && dbUser?.id
    ? Object.fromEntries(Object.entries(todosGroups).map(([k, ps]) => [k, ps.filter(p => recorteDe(p))]))
    : todosGroups;
  const totalPrazos = COLUMNS.reduce((acc, c) => acc + (groups[c.key]?.length || 0), 0);
  const totalTodos = COLUMNS.reduce((acc, c) => acc + (todosGroups[c.key]?.length || 0), 0);
  const nRecorte = (r: 'meus' | 'semDono') => COLUMNS.reduce((acc, c) => acc + (todosGroups[c.key] || []).filter(p => recorteDe(p, r)).length, 0);
  const count = (k: string) => groups[k]?.length || 0;
  const editandoTriagem = Boolean(editingId && groups.triagem?.some(p => p.id === editingId));
  const grupos = useMemo(() => agruparIntimacoes(intimacoes), [intimacoes]);
  // Área calculada uma vez por carga, não a cada chip/tecla (a regra lê o cabeçalho do teor)
  const areaDe = useMemo(() => new Map(grupos.map(g => [g, areaDireito(g.rep)])), [grupos]);
  const naArea = (g: IntGroup, filtro: AreaKey | '' | 'minhas') =>
    !filtro || (filtro === 'minhas' ? minhasAreas.includes(areaDe.get(g)!) : areaDe.get(g) === filtro);
  const semData = (g: IntGroup) => g.rep.prazo?.status === 'A_CONFIRMAR';
  const nSemData = grupos.filter(semData).length;
  const filtraSemData = intSemData;
  const gruposBuscados = grupos.filter(g =>
    (!filtraSemData || semData(g)) && (!intBusca.trim() || buscaMatch(g.rep, intBusca)));
  // Área, tribunal e órgão se combinam; a contagem de cada filtro já respeita os outros
  const naTribunal = (g: IntGroup) => !intTribunal || chaveTribunal(g.rep.tribunal) === intTribunal;
  const naOrgao = (g: IntGroup) => !intOrgao || chaveOrgao(g.rep.orgao) === intOrgao;
  const baseAreas = gruposBuscados.filter(g => naTribunal(g) && naOrgao(g));
  const baseTribunais = gruposBuscados.filter(g => naArea(g, intArea) && naOrgao(g));
  const baseOrgaos = gruposBuscados.filter(g => naArea(g, intArea) && naTribunal(g));
  const gruposFiltrados = baseTribunais.filter(naTribunal);
  const tribunaisOpcoes = tribunaisPresentes(baseTribunais.map(g => g.rep.tribunal));
  // O valor escolhido continua na lista mesmo se sumir do recorte (para dar para voltar a "Todos")
  if (intTribunal && !tribunaisOpcoes.some(t => t.key === intTribunal)) {
    tribunaisOpcoes.push({ key: intTribunal, label: intTribunal === 'SEM' ? 'Sem tribunal' : intTribunal, n: 0 });
  }
  const nPorOrgao = new Map<string, number>();
  baseOrgaos.forEach(g => { const k = chaveOrgao(g.rep.orgao); nPorOrgao.set(k, (nPorOrgao.get(k) || 0) + 1); });
  if (intOrgao && !nPorOrgao.has(intOrgao)) nPorOrgao.set(intOrgao, 0);
  const rotuloOrgao = (k: string) => (k === 'SEM' ? 'Sem órgão' : nomeProprio(k));
  const orgaosOpcoes = [...nPorOrgao.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => ({ key, label: rotuloOrgao(key), n }));
  const rotuloArea = (k: string) => (k === 'minhas' ? '★ Minhas áreas' : AREAS.find(a => a.key === k)?.label || k);
  const nFiltrosInt = (intArea ? 1 : 0) + (intTribunal ? 1 : 0) + (intOrgao ? 1 : 0);

  // Seletor de responsável: sem a lista da equipe, ao menos o próprio usuário
  const opcoesEquipe: Membro[] = equipe.length ? equipe : dbUser?.id ? [{ id: dbUser.id, name: dbUser.name, email: dbUser.email }] : [];
  // Colunas do "Por pessoa" e destinos do "Enviar para": quem o admin pôs no quadro.
  // Enquanto ninguém foi marcado, vale a equipe toda (comportamento anterior).
  const marcados = opcoesEquipe.filter(u => u.noQuadro);
  // Cor fixa por posição na equipe (4 tons que se repetem, em .prazo-av--N no CSS): avatar, coluna e contagem
  const idxPessoa = (id?: string | null) => opcoesEquipe.findIndex(u => u.id === id);
  const avatar = (id?: string | null, nome?: string | null, cls = '') => {
    const idx = idxPessoa(id);
    const m = opcoesEquipe[idx];
    const n = m ? m.name || m.email : nome;
    return <span className={`prazo-av prazo-av--${idx < 0 ? 'x' : idx % 4} ${cls}`} title={n || undefined}>{iniciais(n)}</span>;
  };

  // Paginação por coluna
  const PAGINA = 20;
  const limite = (k: string) => limites[k] || PAGINA;
  const mostrarMais = (k: string, total: number) => total > limite(k) && (
    <button type="button" className="prazo-col-mais" onClick={() => setLimites(l => ({ ...l, [k]: limite(k) + PAGINA }))}>
      Mostrar mais ({total - limite(k)})
    </button>
  );

  // Caixa: colunas por tipo de ato
  const COR_ATO: Record<string, string> = { intimacao: '#b8902e', decisao: '#2563eb', sentenca: '#dc2626', despacho: '#7c3aed', outros: 'var(--text-primary)' };
  const colunasInt = INT_COLUMNS.map(c => {
    const itens = gruposFiltrados.filter(g => tipoBucket(g.rep) === c.key);
    return { ...c, itens, visiveis: itens.slice(0, limite(`i:${c.key}`)) };
  });

  // Quadro: busca + filtros combináveis (aba "Filtros") valem para todas as colunas.
  type FiltroQuadro = { key: string; label: string; de: (p: Prazo) => string; rotulo: (k: string) => string; ordem?: readonly string[]; largo?: boolean };
  const FILTROS_QUADRO: FiltroQuadro[] = [
    { key: 'tipo', label: 'Tipo', de: p => tipoBucket({ tipoDocumento: origemDe(p).tipo }), rotulo: k => INT_COLUMNS.find(c => c.key === k)?.label || k, ordem: INT_COLUMNS.map(c => c.key) },
    { key: 'area', label: 'Área', rotulo: k => AREAS.find(a => a.key === k)?.label || k, ordem: AREAS.map(a => a.key), de: areaDoPrazo },
    { key: 'tribunal', label: 'Tribunal', de: p => chaveTribunal(origemDe(p).tribunal), rotulo: k => (k === 'SEM' ? 'Sem tribunal' : k) },
    { key: 'prioridade', label: 'Prioridade', de: p => p.prioridade || 'SEM', rotulo: k => PRIORIDADES.find(x => x.key === k)?.label || 'Sem prioridade', ordem: [...PRIORIDADES.map(x => x.key), 'SEM'] },
    { key: 'orgao', label: 'Juizado / órgão', de: p => chaveOrgao(origemDe(p).orgao), rotulo: k => (k === 'SEM' ? 'Sem órgão' : nomeProprio(k)), largo: true },
  ];
  const passaFiltros = (p: Prazo, exceto?: string) =>
    FILTROS_QUADRO.every(f => f.key === exceto || !filtrosQuadro[f.key] || f.de(p) === filtrosQuadro[f.key]);
  const naBuscaQuadro = (p: Prazo) =>
    !buscaQuadro.trim() || buscaMatch({ numeroProcesso: p.caseReference, clienteExtraido: p.title }, buscaQuadro);
  const filtraPrazo = (p: Prazo) => naBuscaQuadro(p) && passaFiltros(p);
  const basePrazos = COLUMNS.flatMap(c => groups[c.key] || []).filter(naBuscaQuadro);
  // Opções de um filtro com contagem que já respeita os demais filtros (igual à caixa)
  const opcoesFiltro = (f: FiltroQuadro) => {
    const n = new Map<string, number>();
    basePrazos.filter(p => passaFiltros(p, f.key)).forEach(p => { const k = f.de(p); n.set(k, (n.get(k) || 0) + 1); });
    const atual = filtrosQuadro[f.key];
    if (atual && !n.has(atual)) n.set(atual, 0);
    const pos = (k: string) => f.ordem!.indexOf(k);
    return [...n.entries()]
      .sort((a, b) => (f.ordem ? pos(a[0]) - pos(b[0]) : b[1] - a[1] || f.rotulo(a[0]).localeCompare(f.rotulo(b[0]))))
      .map(([key, qtd]) => ({ key, label: f.rotulo(key), n: qtd }));
  };
  const filtrosAtivos = FILTROS_QUADRO.filter(f => filtrosQuadro[f.key]);
  const nFiltros = filtrosAtivos.length;
  const setFiltro = (key: string, valor: string) => setFiltrosQuadro(fs => ({ ...fs, [key]: valor }));

  // Colunas do quadro: urgência (vencido / hoje / semana / futuro / concluído)
  type ColQuadro = { key: string; label: string; cor: string; empty: string; itens: Prazo[]; porPrioridade?: boolean };
  const COR_TEMPO: Record<string, string> = { triagem: '#7c3aed', vencido: '#dc2626', hoje: '#d97706', semana: '#2563eb', futuro: '#64748b', concluido: '#16a34a' };
  const colunasQuadro: ColQuadro[] = COLUMNS.map(c => {
    const itens = (groups[c.key] || []).filter(filtraPrazo);
    // Vencidos agrupados por prioridade quando alguém definiu prioridade
    const porPrioridade = c.key === 'vencido' && itens.some(p => p.prioridade);
    return { key: c.key, label: c.label, cor: COR_TEMPO[c.key], empty: c.empty, itens: porPrioridade ? ordenarPorPrioridade(itens) : itens, porPrioridade };
  });

  const PRIO_COR: Record<string, string> = { ALTA: '#b91c1c', MEDIA: '#b45309', BAIXA: '#667085', '': '#98a2b3' };
  const rotuloPrio = (k?: string | null) => PRIORIDADES.find(x => x.key === k)?.label;

  const cardPrazo = (p: Prazo) => {
    const origem = p.intimacoes?.[0];
    const tipo = origem?.tipoDocumento || origem?.tipoComunicacao || (p.type ? p.type.charAt(0) + p.type.slice(1).toLowerCase() : '');
    const movido = p.lastMovedBy ? `movido por ${p.lastMovedBy}${p.lastMovedAt ? ` · ${formatDate(p.lastMovedAt)}` : ''}` : undefined;
    return (
      <div
        key={p.id}
        className={`prazo-card ${p.bucket === 'concluido' ? 'prazo-card--done' : ''}`}
        draggable
        // setData é obrigatório: sem dado no dragstart o Firefox nem inicia o arraste
        onDragStart={e => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(p); }}
        onClick={() => abrirEdicao(p)}
        onKeyDown={e => { if (e.key === 'Enter') abrirEdicao(p); }}
        role="button"
        tabIndex={0}
        title={movido}
      >
        <div className="prazo-card-head">
          <span className="prazo-card-title">{p.title}</span>
          {rotuloPrio(p.prioridade) && <span className={`prazo-prio prazo-prio--${p.prioridade!.toLowerCase()}`}>{rotuloPrio(p.prioridade)}</span>}
          {p.bucket !== 'concluido' && (
            <button type="button" className="prazo-icon-btn prazo-card-ok" title="Marcar como cumprido"
              onClick={e => { e.stopPropagation(); setMoveModal({ prazo: p, targetStatus: 'CUMPRIDO' }); }}>
              <Check size={14} />
            </button>
          )}
        </div>
        {p.caseReference && <div className="prazo-card-case">{p.caseReference}</div>}
        {caminhoPje(p.origemPje) && <div className="prazo-card-pje" title="Onde estava no Painel do Advogado do PJe">PJe: {caminhoPje(p.origemPje)}</div>}
        <div className="prazo-card-meta">
          <CalendarClock size={13} />
          {p.bucket === 'triagem' ? (
            <>
              <span>publicado {formatDate(p.fatalDate)}</span>
              <span className={`prazo-card-rel ${-p.daysUntilFatal >= 2 ? 'prazo-card-rel--vencido' : 'prazo-card-rel--triagem'}`}>
                {rotuloTriagem(p.daysUntilFatal)}
              </span>
            </>
          ) : (
            <>
              <span>prazo limite {formatDate(p.fatalDate)}</span>
              {p.bucket !== 'concluido' && (
                <span className={`prazo-card-rel prazo-card-rel--${p.bucket}`}>{relativeLabel(p.daysUntilFatal)}</span>
              )}
            </>
          )}
        </div>
        <div className="prazo-card-foot">
          <div className="prazo-card-tags">
            {tipo && <span className="prazo-tag prazo-tag--tipo">{tipo}</span>}
            {(origem?.tribunal || p.origemPje?.tribunal) && <span className="prazo-tag">{origem?.tribunal || p.origemPje?.tribunal}</span>}
          </div>
          {(p.responsibleId || p.responsibleName) ? (
            p.responsibleId && idxPessoa(p.responsibleId) >= 0
              ? avatar(p.responsibleId, p.responsibleName, 'prazo-av--sm')
              : <span className="prazo-card-resp">{p.responsibleName}</span>
          ) : p.bucket !== 'concluido' && dbUser?.id ? (
            <button type="button" className="prazo-card-pegar" title="Assumir este card e os demais sem dono do mesmo processo"
              onClick={e => { e.stopPropagation(); pegar(p); }}>
              Pegar
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const segmento = <K extends string>(opcoes: readonly (readonly [K, React.ReactNode])[], atual: K, onChange: (k: K) => void, rotulo: string) => (
    <div className="prazo-seg" role="group" aria-label={rotulo}>
      {opcoes.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={atual === k} className={`prazo-seg-btn ${atual === k ? 'prazo-seg-btn--on' : ''}`} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="lx-single-panel prazo-panel">
      <div className="prazo-abas" role="tablist" aria-label="Controle de prazos">
        {([['board', 'Quadro de prazos', count('vencido'), 'prazo-aba-badge prazo-aba-badge--alerta'], ['inbox', 'Caixa de intimações', nSemData, 'prazo-aba-badge']] as const).map(([k, label, n, cls]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`prazo-aba ${view === k ? 'prazo-aba--ativa' : ''}`} onClick={() => setView(k)}>
            {label}
            {n > 0 && <span className={cls}>{n}</span>}
          </button>
        ))}
      </div>

      {view === 'inbox' ? (
        <>
          {/* ── Caixa: título + busca, mês e DJEN ───────────────────────── */}
          <div className="prazo-topo">
            <div className="prazo-titulo">
              <h1>Caixa de intimações</h1>
              <span className="prazo-titulo-sub">
                Tudo que chega vira card no quadro
                {intMes ? ` · ${nomeMes(intMes)}` : ''}
              </span>
            </div>
            <div className="prazo-topo-acoes">
              <div className="prazo-busca">
                <Search size={14} />
                <input value={intBusca} onChange={e => setIntBusca(e.target.value)} placeholder="Buscar processo ou cliente…" aria-label="Buscar por número do processo ou cliente" />
                {intBusca && (
                  <button type="button" className="prazo-busca-limpar" onClick={() => setIntBusca('')} title="Limpar busca"><X size={14} /></button>
                )}
              </div>
              <div className="prazo-mes">
                <button type="button" className="prazo-mes-nav" onClick={() => mudarMes(-1)} title="Mês anterior"><ChevronLeft size={14} /></button>
                <span className="prazo-mes-label">{intMes ? nomeMes(intMes) : 'Todos os meses'}</span>
                <button type="button" className="prazo-mes-nav" onClick={() => mudarMes(1)} title="Próximo mês"><ChevronRight size={14} /></button>
                <button type="button" className="prazo-mes-atual" onClick={() => setIntMes(intMes === mesAtual() ? '' : mesAtual())}>
                  {intMes === mesAtual() ? 'Todos' : 'Mês atual'}
                </button>
              </div>
              <button type="button" className="prazo-btn prazo-btn--navy" onClick={sincronizarDjen} disabled={syncing}>
                {syncing ? <Loader2 className="lx-spin" size={14} /> : <RefreshCw size={14} />}
                {syncing ? 'Consultando DJEN…' : 'Buscar novas no DJEN'}
              </button>
            </div>
          </div>

          {/* ── Sem data/todas · áreas · tribunal · órgão ─────────────────── */}
          <div className="prazo-filtros">
            <div className="prazo-filtros-esq">
              {segmento(
                [
                  ['sem', <>Sem data <span className="prazo-seg-n">{nSemData}</span></>],
                  ['todas', <>Todas <span className="prazo-seg-n">{grupos.length}</span></>],
                ] as const,
                intSemData ? 'sem' : 'todas',
                k => setIntSemData(k === 'sem'),
                'Data fatal do card',
              )}
              <span className="prazo-divisor" />
              <div className="prazo-chips">
                {intArea && (
                  <button type="button" className="prazo-chip prazo-chip--on" title="Remover este filtro" onClick={() => setIntArea('')}>
                    Área: {rotuloArea(intArea)} <X size={12} />
                  </button>
                )}
                {intTribunal && (
                  <button type="button" className="prazo-chip prazo-chip--on" title="Remover este filtro" onClick={() => setIntTribunal('')}>
                    Tribunal: {intTribunal === 'SEM' ? 'Sem tribunal' : intTribunal} <X size={12} />
                  </button>
                )}
                {intOrgao && (
                  <button type="button" className="prazo-chip prazo-chip--on" title="Remover este filtro" onClick={() => setIntOrgao('')}>
                    Órgão: {rotuloOrgao(intOrgao)} <X size={12} />
                  </button>
                )}
                <div className="prazo-menu-wrap">
                  <button
                    type="button"
                    className={`prazo-btn prazo-btn--ghost prazo-btn--sm ${nFiltrosInt ? 'prazo-filtro--on' : ''}`}
                    aria-expanded={menu === 'filtros-caixa'}
                    onClick={() => setMenu(menu === 'filtros-caixa' ? null : 'filtros-caixa')}
                  >
                    <SlidersHorizontal size={14} /> Filtros
                    {nFiltrosInt > 0 && <span className="prazo-chip-n">{nFiltrosInt}</span>}
                    <ChevronDown size={12} />
                  </button>
                  {menu === 'filtros-caixa' && (
                    <div className="prazo-menu prazo-fp" role="dialog" aria-label="Filtros da caixa de intimações">
                      <div className="prazo-fp-topo">
                        <span className="prazo-fp-titulo"><SlidersHorizontal size={14} /> Filtros</span>
                        {nFiltrosInt > 0 && (
                          <button type="button" className="prazo-fp-limpar" onClick={() => { setIntArea(''); setIntTribunal(''); setIntOrgao(''); }}>Limpar</button>
                        )}
                      </div>
                      <label className={`prazo-fp-campo ${intArea ? 'prazo-fp-campo--on' : ''}`}>
                        <span className="prazo-fp-rotulo">Área</span>
                        <select value={intArea} onChange={e => setIntArea(e.target.value as AreaKey | '' | 'minhas')}>
                          <option value="">Todas ({baseAreas.length})</option>
                          {minhasAreas.length > 0 && <option value="minhas">★ Minhas áreas ({baseAreas.filter(g => naArea(g, 'minhas')).length})</option>}
                          {AREAS.map(a => {
                            const n = baseAreas.filter(g => areaDe.get(g) === a.key).length;
                            return (n > 0 || intArea === a.key) && <option key={a.key} value={a.key}>{a.label} ({n})</option>;
                          })}
                        </select>
                      </label>
                      <label className={`prazo-fp-campo ${intTribunal ? 'prazo-fp-campo--on' : ''}`}>
                        <span className="prazo-fp-rotulo">Tribunal</span>
                        <select value={intTribunal} onChange={e => setIntTribunal(e.target.value)}>
                          <option value="">Todos ({baseTribunais.length})</option>
                          {tribunaisOpcoes.map(t => <option key={t.key} value={t.key}>{t.label} ({t.n})</option>)}
                        </select>
                      </label>
                      <label className={`prazo-fp-campo prazo-fp-campo--largo ${intOrgao ? 'prazo-fp-campo--on' : ''}`}>
                        <span className="prazo-fp-rotulo">Juizado / órgão</span>
                        <select value={intOrgao} onChange={e => setIntOrgao(e.target.value)}>
                          <option value="">Todos ({baseOrgaos.length})</option>
                          {orgaosOpcoes.map(o => <option key={o.key} value={o.key}>{o.label} ({o.n})</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {intLoading ? (
            <div className="prazo-loading"><Loader2 className="lx-spin" size={32} /></div>
          ) : intimacoes.length === 0 ? (
            <div className="prazo-empty-all">
              <Inbox size={48} className="prazo-empty-icon" />
              <h3>
                Nenhuma intimação
                {intMes ? ` em ${nomeMes(intMes)}` : ''}
              </h3>
              {intMes && <button className="lx-btn-tool" onClick={() => setIntMes('')}>Ver todos os meses</button>}
            </div>
          ) : gruposFiltrados.length === 0 ? (
            <div className="prazo-empty-all">
              <Search size={48} className="prazo-empty-icon" />
              <h3>{filtraSemData && !intBusca.trim() ? 'Nada sem data' : 'Nenhum resultado'}{intBusca.trim() ? ` para "${intBusca.trim()}"` : ''}</h3>
              {filtraSemData ? (
                <>
                  <p>{intBusca.trim() ? 'Pode estar entre as que já têm data fatal.' : `Todas as intimações ${intMes ? `de ${nomeMes(intMes)} ` : ''}já têm data fatal no quadro.`}</p>
                  <button className="lx-btn-tool" onClick={() => setIntSemData(false)}>Ver todas</button>
                </>
              ) : intMes ? (
                <>
                  <p>Não encontrei em {nomeMes(intMes)} — o processo pode ter publicações em outro mês.</p>
                  <button className="lx-btn-tool" onClick={() => setIntMes('')}>Buscar em todos os meses</button>
                </>
              ) : (
                <p>Confira o número digitado ou limpe os filtros de área e tribunal.</p>
              )}
            </div>
          ) : (
            <div className="prazo-area-trabalho">
              <div className="prazo-kanban prazo-kanban--caixa">
                {colunasInt.map(col => (
                  <section key={col.key} className="prazo-col" style={{ '--cor': COR_ATO[col.key] } as React.CSSProperties}>
                    <header className="prazo-col-header">
                      <span className="prazo-col-title">{col.label}</span>
                      <span className="prazo-col-count">{col.itens.length}</span>
                    </header>
                    <div className="prazo-col-body">
                      {col.itens.length === 0 && <div className="prazo-col-empty">Nenhuma</div>}
                      {col.visiveis.map(g => {
                        const i = g.rep;
                        const tipo = i.tipoDocumento || i.tipoComunicacao;
                        return (
                          <div
                            key={i.id}
                            className="prazo-int-card"
                          >
                            <div className="prazo-int-head">
                              <div className="prazo-int-id">
                                <div className="prazo-int-linha">
                                  <span className="prazo-int-cliente">{nomeProprio(i.clienteExtraido) || 'Cliente não identificado'}</span>
                                  {g.datas.length > 0 && <span className="prazo-int-date">{g.datas.join(' · ')}</span>}
                                </div>
                                <div className="prazo-int-proc">
                                  <span className="prazo-num">{formatarNumeroCnj(i.numeroProcesso) || 'Processo não identificado'}</span>
                                  {i.nomeClasse && ` · ${nomeProprio(i.nomeClasse)}`}
                                </div>
                              </div>
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
                                      <a className="prazo-int-pub-link" href={pub.hash ? `${API_DJEN}/${pub.hash}/certidao` : linkSeguro(pub.link)} target="_blank" rel="noopener noreferrer" title="Certidão desta publicação (PDF)">
                                        <ExternalLink size={12} /> certidão
                                      </a>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}

                            {i.texto && (
                              <div
                                className={`prazo-int-texto ${expandedId === i.id ? 'prazo-int-texto--full' : ''}`}
                                role="button"
                                tabIndex={0}
                                title={expandedId === i.id ? 'Recolher o teor' : 'Ver o teor completo'}
                                onClick={() => setExpandedId(expandedId === i.id ? null : i.id)}
                                onKeyDown={e => { if (e.key === 'Enter') setExpandedId(expandedId === i.id ? null : i.id); }}
                              >
                                {i.texto}
                              </div>
                            )}

                            {i.expedientePje && (() => {
                              const e = i.expedientePje;
                              const texto = e.dataLimite
                                ? <>prazo {e.prazoDias} dias · limite <strong>{formatDate(e.dataLimite)}</strong></>
                                : e.cienciaPendente ? <>prazo {e.prazoDias ?? '—'} dias · aguardando ciência</>
                                : e.prazoDias === null ? <>sem prazo</>
                                : <>prazo {e.prazoDias} dias</>;
                              return (
                                <div className="prazo-int-pje" title={`Expediente ${e.idExpediente} — dado lido do Painel do Advogado do PJe (${e.tribunal})`}>
                                  <CalendarClock size={13} /> <span className="prazo-int-pje-fonte">PJe</span> {texto}
                                  {caminhoPje(e) && <span className="prazo-int-pje-caminho">{caminhoPje(e)}</span>}
                                </div>
                              );
                            })()}

                            <div className="prazo-int-meta">
                              <div className="prazo-int-tags">
                                {i.tribunal && <span className="prazo-int-trib">{i.tribunal}</span>}
                                {tipo && <span className="prazo-int-tipo" style={{ '--cor': COR_ATO[tipoBucket(i)] } as React.CSSProperties}><i className="prazo-dot" />{tipo}</span>}
                                {g.ids.length > 1 && (
                                  <button
                                    type="button"
                                    className={`prazo-int-extra ${pubsAbertas === i.id ? 'prazo-int-extra--on' : ''}`}
                                    onClick={() => setPubsAbertas(pubsAbertas === i.id ? null : i.id)}
                                    title="O tribunal publicou este mesmo ato uma vez por destinatário/advogado. Clique para ver todas."
                                  >
                                    ×{g.ids.length} publicações
                                  </button>
                                )}
                              </div>
                              {(i.hash || i.link) && (
                                <a
                                  className="prazo-int-abrir"
                                  href={i.hash ? `${API_DJEN}/${i.hash}/certidao` : linkSeguro(i.link)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={i.hash ? 'Abrir a certidão oficial da comunicação (PDF)' : 'Abrir no PJe do tribunal'}
                                >
                                  Abrir <ExternalLink size={12} />
                                </a>
                              )}
                            </div>

                            {i.prazo ? (
                              <div className={`prazo-int-vinculo ${i.prazo.status === 'CUMPRIDO' ? 'prazo-int-vinculo--done' : ''}`}>
                                {i.prazo.status === 'CUMPRIDO' ? <Check size={13} /> : <CalendarClock size={13} />}
                                <span className="prazo-int-vinculo-titulo">{i.prazo.title}</span>
                                <span className="prazo-int-vinculo-fatal">
                                  {/* No A_CONFIRMAR o fatalDate é só o piso (publicação), não um prazo */}
                                  {i.prazo.status === 'A_CONFIRMAR' ? 'sem data · a confirmar' : `prazo limite ${formatDate(i.prazo.fatalDate)}`}
                                </span>
                              </div>
                            ) : (
                              <div className="prazo-int-vinculo prazo-int-vinculo--orfao">
                                <X size={13} /> <span>O prazo vinculado foi excluído do quadro.</span>
                              </div>
                            )}

                            <div className="prazo-int-footer">
                              {i.revisadoPor ? <span className="prazo-int-revisado">revisado por {i.revisadoPor}</span> : <span />}
                              {i.prazo && (
                                <div className="prazo-int-envio">
                                  <button type="button" className="prazo-btn prazo-btn--ghost prazo-btn--sm" onClick={() => setView('board')}>Ver no quadro</button>
                                  {i.prazo.status !== 'CUMPRIDO' && (
                                    <button
                                      type="button"
                                      className="prazo-btn prazo-btn--navy prazo-btn--sm"
                                      onClick={() => setMoveModal({ prazo: i.prazo!, targetStatus: 'CUMPRIDO' })}
                                    >
                                      <Check size={13} /> Concluir
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {mostrarMais(`i:${col.key}`, col.itens.length)}
                    </div>
                  </section>
                ))}
              </div>

            </div>
          )}

        </>
      ) : (
        <>
          {/* ── Quadro: título, visão e resumo · busca, prioridade, mais, novo ── */}
          <div className="prazo-topo">
            <div className="prazo-titulo">
              <h1>Quadro de prazos</h1>
              {!loading && (
                <span className="prazo-resumo">
                  <span className="prazo-resumo--vencido">{count('vencido')} vencido{count('vencido') !== 1 ? 's' : ''}</span>
                  <span className="prazo-sep">·</span>
                  <span className="prazo-resumo--hoje">{count('hoje')} hoje</span>
                  <span className="prazo-sep">·</span>
                  <span>{count('semana')} esta semana</span>
                </span>
              )}
            </div>
            <div className="prazo-topo-acoes">
              <div className="prazo-busca">
                <Search size={14} />
                <input value={buscaQuadro} onChange={e => setBuscaQuadro(e.target.value)} placeholder="Buscar processo ou cliente…" aria-label="Buscar prazo por processo ou cliente" />
                {buscaQuadro && <button type="button" className="prazo-busca-limpar" onClick={() => setBuscaQuadro('')} title="Limpar busca"><X size={14} /></button>}
              </div>
              {dbUser?.id && segmento([
                ['meus', <>Meus <span className="prazo-seg-n">{nRecorte('meus')}</span></>],
                ['semDono', <>Sem dono <span className="prazo-seg-n">{nRecorte('semDono')}</span></>],
                ['todos', <>Todos <span className="prazo-seg-n">{totalTodos}</span></>],
              ] as const, recorte, setRecorte, 'Recorte do quadro')}
              {filtrosAtivos.map(f => (
                <button key={f.key} type="button" className="prazo-chip prazo-chip--on" title="Remover este filtro" onClick={() => setFiltro(f.key, '')}>
                  {f.label}: {f.rotulo(filtrosQuadro[f.key])} <X size={12} />
                </button>
              ))}
              <div className="prazo-menu-wrap">
                <button
                  type="button"
                  className={`prazo-btn prazo-btn--ghost ${nFiltros ? 'prazo-filtro--on' : ''}`}
                  aria-expanded={menu === 'filtros'}
                  onClick={() => setMenu(menu === 'filtros' ? null : 'filtros')}
                >
                  <SlidersHorizontal size={14} /> Filtros
                  {nFiltros > 0 && <span className="prazo-chip-n">{nFiltros}</span>}
                  <ChevronDown size={12} />
                </button>
                {menu === 'filtros' && (
                  <div className="prazo-menu prazo-menu--direita prazo-fp" role="dialog" aria-label="Filtros do quadro">
                    <div className="prazo-fp-topo">
                      <span className="prazo-fp-titulo"><SlidersHorizontal size={14} /> Filtros</span>
                      {nFiltros > 0 && (
                        <button type="button" className="prazo-fp-limpar" onClick={() => setFiltrosQuadro({})}>Limpar</button>
                      )}
                    </div>
                    {FILTROS_QUADRO.map(f => (
                      <label key={f.key} className={`prazo-fp-campo ${f.largo ? 'prazo-fp-campo--largo' : ''} ${filtrosQuadro[f.key] ? 'prazo-fp-campo--on' : ''}`}>
                        <span className="prazo-fp-rotulo">{f.label}</span>
                        <select value={filtrosQuadro[f.key] || ''} onChange={e => setFiltro(f.key, e.target.value)}>
                          <option value="">Todos</option>
                          {opcoesFiltro(f).map(o => <option key={o.key} value={o.key}>{o.label} ({o.n})</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="prazo-menu-wrap">
                <button type="button" className="prazo-btn prazo-btn--ghost prazo-btn--icon" title="Mais ações" aria-expanded={menu === 'quadro'} onClick={() => setMenu(menu === 'quadro' ? null : 'quadro')}>
                  <MoreHorizontal size={16} />
                </button>
                {menu === 'quadro' && (
                  <div className="prazo-menu prazo-menu--direita" role="menu">
                    <button type="button" role="menuitem" className="prazo-menu-item" onClick={() => { setMenu(null); setImportOpen(true); }}>
                      <Upload size={14} /> Importar planilha
                    </button>
                    {isAdmin && (
                      <button type="button" role="menuitem" className="prazo-menu-item" onClick={() => { setMenu(null); setPerfisOpen(true); }}>
                        <Users size={14} /> Perfis no quadro
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button type="button" className="prazo-btn prazo-btn--ghost" onClick={sincronizarPje} disabled={syncingPje}
                title="Lê o Painel do Advogado (certificado digital) e traz o prazo e a data limite calculados pelo PJe">
                {syncingPje ? <Loader2 className="lx-spin" size={14} /> : <CalendarClock size={14} />}
                {syncingPje ? 'Lendo o PJe…' : 'Buscar prazos no PJe'}
              </button>
              <button type="button" className="prazo-btn prazo-btn--navy" onClick={abrirNovo}><Plus size={15} /> Novo prazo</button>
            </div>
          </div>

          {loading ? (
            <div className="prazo-loading"><Loader2 className="lx-spin" size={32} /></div>
          ) : totalPrazos === 0 && recorte !== 'todos' && totalTodos > 0 ? (
            <div className="prazo-empty-all">
              <CalendarClock size={48} className="prazo-empty-icon" />
              <h3>{recorte === 'meus' ? 'Nenhum prazo no seu nome' : 'Nenhum card sem dono nas suas áreas'}</h3>
              <p>{recorte === 'meus' ? 'Pegue um card em "Sem dono": ele e os demais do mesmo processo passam para o seu nome.' : 'Tudo o que chegou já tem dono.'}</p>
              <div className="prazo-empty-actions">
                {recorte === 'meus' && nRecorte('semDono') > 0 && (
                  <button className="prazo-btn prazo-btn--navy" onClick={() => setRecorte('semDono')}>Ver sem dono ({nRecorte('semDono')})</button>
                )}
                <button className="lx-btn-tool" onClick={() => setRecorte('todos')}>Ver todos os prazos ({totalTodos})</button>
              </div>
            </div>
          ) : (
            <div className="prazo-kanban prazo-kanban--quadro">
              {colunasQuadro.map(col => {
                const k = `q:${col.key}`;
                const visiveis = col.itens.slice(0, limite(k));
                return (
                  <section
                    key={col.key}
                    className={`prazo-col ${dragOverCol === col.key ? 'prazo-col--dragover' : ''}`}
                    style={{ '--cor': col.cor } as React.CSSProperties}
                    onDragOver={e => onColDragOver(e, col.key)}
                    onDragLeave={onColDragLeave}
                    onDrop={() => onColDrop(col.key)}
                  >
                    <header className="prazo-col-header">
                      <div className="prazo-col-nome">
                        <span className="prazo-col-title">{col.label}</span>
                      </div>
                      <span className="prazo-col-count">{col.itens.length}</span>
                    </header>
                    <div className="prazo-col-body">
                      {col.itens.length === 0 && (
                        <div className={col.key === 'concluido' ? 'prazo-col-alvo' : 'prazo-col-empty'}>{col.empty}</div>
                      )}
                      {visiveis.map((p, idx) => {
                        const prio = p.prioridade || '';
                        const cabecalho = col.porPrioridade && (idx === 0 || (visiveis[idx - 1].prioridade || '') !== prio);
                        return (
                          <div key={p.id} className="prazo-card-slot">
                            {cabecalho && (
                              <div className="prazo-grupo" style={{ '--cor': PRIO_COR[prio] } as React.CSSProperties}>
                                <i className="prazo-dot" />
                                {prio ? `Prioridade ${(rotuloPrio(prio) || prio).toLowerCase()}` : 'Sem prioridade'}
                                <span className="prazo-grupo-n">{col.itens.filter(x => (x.prioridade || '') === prio).length}</span>
                              </div>
                            )}
                            {cardPrazo(p)}
                          </div>
                        );
                      })}
                      {mostrarMais(k, col.itens.length)}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Modal criar / editar */}
      {modalOpen && (
        <div className="prazo-modal-overlay" onClick={() => { if (!saving) setModalOpen(false); }}>
          <div className="prazo-modal" onClick={e => e.stopPropagation()}>
            <div className="prazo-modal-header">
              <h3>{editingId ? (editandoTriagem ? 'Confirmar data fatal' : 'Editar prazo') : 'Novo prazo'}</h3>
              <button className="prazo-icon-btn" title="Fechar" onClick={() => setModalOpen(false)}><X size={18} /></button>
            </div>
            {editandoTriagem && (
              <p className="prazo-modal-nota">
                O tribunal não informou a data fatal: a data abaixo é só a publicação.
                Informe a data real e o card entra no quadro.
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
                <select
                  id="prazo-resp"
                  value={form.responsibleId}
                  onChange={e => {
                    const m = opcoesEquipe.find(u => u.id === e.target.value);
                    setForm(f => ({ ...f, responsibleId: e.target.value, responsibleName: m ? m.name || m.email : '' }));
                  }}
                >
                  {/* Prazo antigo com responsável só em texto (ex.: importado): mantém o nome até alguém trocar */}
                  <option value="">
                    {!form.responsibleId && form.responsibleName ? `${form.responsibleName} (sem cadastro)` : 'Sem responsável'}
                  </option>
                  {opcoesEquipe.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </select>
              </div>
              <div className="prazo-field-row">
                <div className="prazo-field">
                  <label htmlFor="prazo-type">Tipo</label>
                  <select id="prazo-type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                    {TYPES.map(t => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
                  </select>
                </div>
                <div className="prazo-field">
                  <label htmlFor="prazo-prio">Prioridade</label>
                  <select id="prazo-prio" value={form.prioridade} onChange={e => setForm(f => ({ ...f, prioridade: e.target.value }))}>
                    <option value="">Sem prioridade</option>
                    {PRIORIDADES.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="prazo-field-row">
                <div className="prazo-field">
                  <label htmlFor="prazo-fatal">Prazo limite *</label>
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
              {editingId && (() => {
                const atual = Object.values(todosGroups).flat().find(p => p.id === editingId);
                return atual && (
                  <button type="button" className="prazo-btn prazo-btn--perigo" onClick={() => excluir(atual)} disabled={saving}>
                    <Trash2 size={14} /> Excluir
                  </button>
                );
              })()}
              <button className="lx-btn-tool" onClick={() => setModalOpen(false)} disabled={saving}>Cancelar</button>
              <button className="lx-btn-primary" onClick={salvar} disabled={saving}>
                {saving ? <Loader2 className="lx-spin" size={16} /> : <Check size={16} />}
                {editingId ? 'Salvar alterações' : 'Criar prazo'}
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
              <p className="prazo-move-desc">Fica registrado como movimentado por <strong>{defaultMover || 'você'}</strong>.</p>
            </div>
            <div className="prazo-modal-footer">
              <button className="lx-btn-tool" onClick={() => setMoveModal(null)}>Cancelar</button>
              <button className="lx-btn-primary" onClick={confirmarMovimentacao} autoFocus>
                <Check size={16} /> Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Perfis do quadro (admin) */}
      {perfisOpen && isAdmin && (
        <div className="prazo-modal-overlay" onClick={() => !salvandoPerfil && setPerfisOpen(false)}>
          <div className="prazo-modal prazo-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="prazo-modal-header">
              <h3>Perfis no quadro</h3>
              <button className="prazo-icon-btn" title="Fechar" onClick={() => setPerfisOpen(false)}><X size={18} /></button>
            </div>
            <div className="prazo-form">
              <p className="prazo-import-hint">
                Quem estiver marcado ganha uma coluna no quadro "Por pessoa" e aparece no "Enviar para".
                {!marcados.length && ' Enquanto ninguém for marcado, aparece a equipe toda.'}
              </p>
              <div className="prazo-perfis">
                {opcoesEquipe.map(u => (
                  <label key={u.id} className="prazo-perfil">
                    <input type="checkbox" checked={!!u.noQuadro} onChange={e => marcarNoQuadro(u, e.target.checked)} />
                    {avatar(u.id)}
                    <span className="prazo-envio-nome">
                      {u.name || u.email}
                      {u.name && <small>{u.email}</small>}
                    </span>
                  </label>
                ))}
              </div>
              <form
                className="prazo-perfil-novo"
                onSubmit={e => { e.preventDefault(); if (novoPerfil.name.trim() && novoPerfil.email.trim()) adicionarPerfil(); }}
              >
                <span className="prazo-perfis-titulo">Adicionar pessoa</span>
                <input type="text" placeholder="Nome" aria-label="Nome" value={novoPerfil.name}
                  onChange={e => setNovoPerfil(n => ({ ...n, name: e.target.value }))} />
                <input type="email" placeholder="E-mail de login" aria-label="E-mail de login" value={novoPerfil.email}
                  onChange={e => setNovoPerfil(n => ({ ...n, email: e.target.value }))} />
                <button type="submit" className="lx-btn-primary" disabled={salvandoPerfil || !novoPerfil.name.trim() || !novoPerfil.email.trim()}>
                  {salvandoPerfil ? <Loader2 className="lx-spin" size={14} /> : <Plus size={14} />} Adicionar
                </button>
              </form>
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
              <p className="prazo-import-hint">Colunas: Título, Processo/Cliente, Responsável, Tipo, Prazo Limite, Prazo Interno, Observações. Só Título e Prazo Limite são obrigatórios.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
