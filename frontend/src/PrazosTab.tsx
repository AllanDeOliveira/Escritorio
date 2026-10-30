import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Check, Trash2, X, CalendarClock, Loader2, Upload, Download,
  RefreshCw, ExternalLink, Search,
  ChevronDown, Users, MoreHorizontal, SlidersHorizontal, Undo2,
} from 'lucide-react';
import './PrazosTab.css';
import { apiFetch, API, type Usuario } from './api';

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
  status?: string;
}

// Tipos de ato (filtro "Tipo" do quadro).
export const INT_COLUMNS = [
  { key: 'intimacao', label: 'Intimações', cls: 'prazo-int-col--intimacao' },
  { key: 'decisao', label: 'Decisões', cls: 'prazo-int-col--decisao' },
  { key: 'sentenca', label: 'Sentenças', cls: 'prazo-int-col--sentenca' },
  { key: 'despacho', label: 'Despachos', cls: 'prazo-int-col--despacho' },
  { key: 'outros', label: 'Outros', cls: 'prazo-int-col--outros' },
] as const;

type IntColKey = (typeof INT_COLUMNS)[number]['key'];

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

// Jurisdições que aparecem no filtro mesmo sem nenhum prazo: lista do Painel do Advogado do
// PJe do TJMT 1º grau. Jurisdição nova que chegar nos dados entra sozinha; esta lista é só a base.
export const JURISDICOES = [
  'ALTO ARAGUAIA', 'ALTO ARAGUAIA JUIZADOS', 'ARAPUTANGA', 'ARAPUTANGA JUIZADOS', 'ARENÁPOLIS',
  'BARRA DO BUGRES', 'BARRA DO BUGRES JUIZADOS', 'CEJUSC DA FAZENDA PÚBLICA', 'COMODORO',
  'CUIABÁ CÍVEL', 'CUIABÁ JUIZADOS', 'CÁCERES', 'CÁCERES JUIZADOS', 'DIAMANTINO', 'DIAMANTINO JUIZADOS',
  'JAURU', 'JAURU JUIZADOS', 'JUARA', 'JUARA JUIZADOS', 'LUCAS DO RIO VERDE', 'LUCAS DO RIO VERDE JUIZADOS',
  "MIRASSOL D'OESTE", "MIRASSOL D'OESTE JUIZADOS", 'NOBRES', 'NOVA UBIRATÃ JUIZADOS',
  'NÚCLEO DE JUSTIÇA DIGITAL DOS JUIZADOS ESPECIAIS', 'NÚCLEOS DE JUSTIÇA 4.0', 'POCONÉ', 'PONTES E LACERDA',
  'PORTO ESPERIDIÃO', 'RIO BRANCO', 'RIO BRANCO JUIZADOS', 'RONDONÓPOLIS JUIZADOS', 'ROSÁRIO OESTE',
  'SINOP JUIZADOS', 'SORRISO', 'SORRISO JUIZADOS', 'STO ANTÔNIO DO LEVERGER', 'SÃO JOSÉ DOS QUATRO MARCOS',
  'SÃO JOSÉ DOS QUATRO MARCOS JUIZADOS', 'TANGARÁ DA SERRA', 'VILA BELA DA SANTÍSSIMA TRINDADE JUIZADOS',
  'VÁRZEA GRANDE', 'VÁRZEA GRANDE JUIZADOS',
  // TJMT 2º grau
  'TJMT - 2º GRAU', 'TURMA RECURSAL ÚNICA',
  // TRF1 1º grau
  'SEÇÃO JUDICIÁRIA DE MATO GROSSO', 'SUBSEÇÃO JUDICIÁRIA DE BARRA DO GARÇAS-MT', 'SUBSEÇÃO JUDICIÁRIA DE CÁCERES-MT',
  'SUBSEÇÃO JUDICIÁRIA DE DIAMANTINO-MT', 'SUBSEÇÃO JUDICIÁRIA DE RONDONÓPOLIS-MT',
  // TRF1 2º grau
  'NÚCLEOS DE JUSTIÇA 4.0 (TRF1)', 'TRIBUNAL REGIONAL FEDERAL DA 1ª REGIÃO',
  'TURMA RECURSAL DOS JUIZADOS ESPECIAIS FEDERAIS DA SJMT',
  // TRT23 1º grau (sufixo: os nomes repetem as comarcas do TJMT)
  'ALTO ARAGUAIA (TRT23)', 'CUIABÁ (TRT23)', 'CÁCERES (TRT23)', 'MIRASSOL D OESTE (TRT23)',
  // TRT23 2º grau
  '1ª TURMA (TRT23)', '2ª TURMA (TRT23)', 'OJC DE ANÁLISE DE RECURSO (TRT23)',
] as const;

// Jurisdição como no Painel do Advogado do PJe ("CÁCERES", "CÁCERES JUIZADOS", "CUIABÁ CÍVEL").
// Expediente do PJe já traz pronta; intimação só do DJEN tem o órgão, então derivamos dele.
// Órgão que não reconhecemos (TRT, STJ...) fica como está — não mistura com a comarca do TJMT.
export function jurisdicaoDe(orgao?: string | null, tribunal?: string | null, jurisdicaoPje?: string | null): string {
  const t = chaveTribunal(tribunal);
  // Os dois PJe têm "Núcleos de Justiça 4.0": o do TRF1 leva o sufixo para não somar com o do TJMT
  const nucleo40 = 'NÚCLEOS DE JUSTIÇA 4.0';
  if (jurisdicaoPje?.trim()) {
    const j = chaveOrgao(jurisdicaoPje);
    return j === nucleo40 && t.startsWith('TRF1') ? `${nucleo40} (TRF1)` : j;
  }
  const o = chaveOrgao(orgao);
  if (o === 'SEM') return o;
  if (t === 'TJMT') {
    if (o.includes('NÚCLEO DE JUSTIÇA DIGITAL')) return 'NÚCLEO DE JUSTIÇA DIGITAL DOS JUIZADOS ESPECIAIS';
    if (o.includes('TURMA RECURSAL')) return 'TURMA RECURSAL ÚNICA';
    if (/CÂMARA|PRESIDÊNCIA|ÓRGÃO ESPECIAL|TRIBUNAL PLENO|SEÇÃO/.test(o)) return 'TJMT - 2º GRAU';
    const comarca = /.* DE (.+)$/.exec(o.replace(/ - .*$/, ''))?.[1];
    if (!comarca) return o;
    if (o.includes('JUIZADO')) return `${comarca} JUIZADOS`;
    return comarca === 'CUIABÁ' ? 'CUIABÁ CÍVEL' : comarca;
  }
  if (t === 'TRF1') {
    const ssj = /SSJ DE (.+)$/.exec(o)?.[1];
    if (ssj) return `SUBSEÇÃO JUDICIÁRIA DE ${ssj}`;
    if (o.includes('TURMA RECURSAL DA SJMT')) return 'TURMA RECURSAL DOS JUIZADOS ESPECIAIS FEDERAIS DA SJMT';
    // Vara federal de Cuiabá ("... DA SJMT"): sede da seção, sem subseção no nome
    if (/\bSJMT\b|SEÇÃO JUDICIÁRIA DE MATO GROSSO/.test(o)) return 'SEÇÃO JUDICIÁRIA DE MATO GROSSO';
    if (o.includes('4.0')) return `${nucleo40} (TRF1)`;
    if (o.includes('DESEMBARGADOR')) return 'TRIBUNAL REGIONAL FEDERAL DA 1ª REGIÃO';
  }
  // Tribunais superiores: uma jurisdição só, sem quebrar por coordenadoria/gabinete
  if (t === 'STJ' || t === 'STF') return t;
  if (t.startsWith('TRT23')) {
    // "1ª VARA DO TRABALHO DE CUIABÁ" → "CUIABÁ (TRT23)"; o PJe do TRT grafa "MIRASSOL D OESTE" sem apóstrofo
    const cidade = /VARA DO TRABALHO DE (.+)$/.exec(o)?.[1];
    if (cidade) return `${cidade.replace(/['’]/g, ' ').replace(/\s+/g, ' ')} (TRT23)`;
    // 2º grau: gabinete de desembargador cai na turma; "OJC" = análise de recurso de revista
    const turma = /\b([12])ª TURMA\b/.exec(o)?.[1];
    if (turma) return `${turma}ª TURMA (TRT23)`;
    if (/\bOJC\b|ANÁLISE DE RECURSO/.test(o)) return 'OJC DE ANÁLISE DE RECURSO (TRT23)';
  }
  return o;
}

// Tribunal de uma intimação como chave de filtro ('SEM' quando o DJEN não informa)
function chaveTribunal(t?: string | null): string {
  return (t || '').trim().toUpperCase() || 'SEM';
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

// Partículas de nome (da, de...) não viram inicial
const PARTICULAS = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

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

interface PrazosTabProps {
  dbUser: Usuario;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  // Depois de buscar no DJEN: o App relê o status (faixa de robô parado, badge)
  onSincronizado?: () => void;
  // Última leitura do PJe enviada pelo robô de um PC (do status que o App já carrega)
  pje?: { lastAttemptAt: string | null; lastBy?: string | null };
}

type Membro = { id: string; name?: string | null; email: string; noQuadro?: boolean; ativo?: boolean };

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
    jurisdicao: jurisdicaoDe(o?.orgao || p.origemPje?.orgao, o?.tribunal || p.origemPje?.tribunal, p.origemPje?.jurisdicao),
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

export default function PrazosTab({ dbUser, showToast, onSincronizado, pje }: PrazosTabProps) {
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
  // Clique no card: só os dados do processo (editar fica no botão do card)
  const [infoCard, setInfoCard] = useState<Prazo | null>(null);
  const [moveModal, setMoveModal] = useState<{ prazo: Pick<Prazo, 'id' | 'title'> & { caseReference?: string | null }; targetStatus: string } | null>(null);

  // Importação
  const [importOpen, setImportOpen] = useState(false);

  // Perfis do quadro "Por pessoa" (só admin gerencia)
  const [perfisOpen, setPerfisOpen] = useState(false);
  const [novoPerfil, setNovoPerfil] = useState({ name: '', email: '', senha: '' });
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const isAdmin = dbUser?.role === 'admin';
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [syncing, setSyncing] = useState(false);
  // Intimações do card aberto no modal (teor e certidão); null = carregando
  const [infoInts, setInfoInts] = useState<Intimacao[] | null>(null);

  // Distribuição por área: cada pessoa tria as próprias áreas e fica com os prazos que gera
  const minhasAreas = (dbUser?.areas || []) as AreaKey[];
  // Recorte do quadro: meus cards | sem dono (das minhas áreas) | todos
  const [recorte, setRecorte] = useState<'meus' | 'semDono' | 'todos'>('todos');
  const [equipe, setEquipe] = useState<Membro[]>([]);

  // Quadro: colunas por pessoa (distribuição) ou por urgência
  // "Enviar para": intimação com o seletor aberto, pessoa e prazo limite escolhidos
  // Menu aberto: ⋯ de um card (id da intimação), 'lote' ou 'quadro'
  const [menu, setMenu] = useState<string | null>(null);
  // Quadro: busca e filtro de prioridade
  const [buscaQuadro, setBuscaQuadro] = useState('');
  // Filtros do quadro (aba "Filtros"): chave do filtro → valores marcados (vazio = todos; vários = OU)
  const [filtrosQuadro, setFiltrosQuadro] = useState<Record<string, string[]>>({});

  // Fecha menus ao clicar fora
  useEffect(() => {
    if (!menu) return;
    const fechar = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.prazo-menu-wrap')) setMenu(null); };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [menu]);

  const defaultMover = dbUser?.name || dbUser?.email || '';

  // Quem participa da distribuição abre no próprio recorte.
  // Roda quando o usuário carrega, que pode ser depois do mount.
  useEffect(() => {
    if (dbUser?.areas?.length) setRecorte('meus');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbUser?.id]);

  // Equipe para o seletor de responsável (quem já entrou uma vez no sistema)
  useEffect(() => {
    apiFetch(`${API}/api/users`)
      .then(r => r.json())
      .then(d => { if (d.success) setEquipe(d.users); })
      .catch(() => { /* seletor cai para só o usuário logado */ });
  }, [dbUser?.id]);


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
  }, [dbUser?.id]);

  useEffect(() => { carregar(); }, [carregar]);

  // Modal do card: teor e certidão das intimações ligadas, buscados só quando o card abre
  // (o quadro inteiro com o teor de cada intimação pesaria vários MB)
  useEffect(() => {
    if (!infoCard) return;
    let vivo = true; // fechou ou abriu outro card antes da resposta: descarta
    setInfoInts(null);
    apiFetch(`${API}/api/intimacoes?prazoId=${encodeURIComponent(infoCard.id)}`)
      .then(r => r.json())
      .then(d => { if (vivo) setInfoInts(d.success ? d.intimacoes : []); })
      .catch(() => { if (vivo) setInfoInts([]); });
    return () => { vivo = false; };
  }, [infoCard]);

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
        carregar(); // o quadro pode ter ganhado cards
      } else {
        showToast(d.error || 'Falha ao consultar o DJEN.', 'error');
      }
    } catch {
      showToast('Erro de conexão com o DJEN.', 'error');
    } finally {
      setSyncing(false);
      onSincronizado?.();
    }
  };

  // O PJe não é lido daqui: o robô roda no PC de quem tem o certificado (robo-pje/) e envia a
  // leitura ao servidor. A tela só mostra quando foi a última e quem enviou.
  const ultimaLeituraPje = pje?.lastAttemptAt
    ? `${new Date(pje.lastAttemptAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${pje.lastBy ? ` por ${pje.lastBy}` : ''}`
    : 'nenhuma ainda';

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

  // Desativar = ex-funcionário: não entra mais e é desconectado na hora (os prazos dele ficam)
  const marcarAtivo = async (u: Membro, ativo: boolean) => {
    try {
      const r = await apiFetch(`${API}/api/users/${u.id}/ativo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo }),
      });
      const d = await r.json();
      if (d.success) setEquipe(eq => eq.map(x => x.id === u.id ? { ...x, ativo } : x));
      else showToast(d.error || 'Erro ao atualizar o usuário.', 'error');
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
        setNovoPerfil({ name: '', email: '', senha: '' });
        showToast(`${d.user.name || d.user.email} já pode entrar com a senha cadastrada.`, 'success');
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
    (window as any).showConfirm(`Excluir o prazo "${p.title}"? Ele vai para a lixeira (menu ⋯) e pode ser restaurado.`, async () => {
      try {
        const r = await apiFetch(`${API}/api/prazos/${p.id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error); // sucesso é 204 sem corpo
        setModalOpen(false);
        showToast('Prazo movido para a lixeira.', 'info');
        carregar();
      } catch (e) { showToast((e as Error).message || 'Erro ao excluir.', 'error'); }
    });
  };

  // Lixeira: cards excluídos por pessoas (CANCELADO). Os que o robô cancelou ao juntar
  // duplicados do DJEN ficam de fora — restaurar um deles recriaria a duplicata.
  const [lixeira, setLixeira] = useState<Prazo[] | null>(null); // null = fechada
  const abrirLixeira = async () => {
    setLixeira([]);
    try {
      const d = await (await apiFetch(`${API}/api/prazos?status=CANCELADO`)).json();
      if (!d.success) throw new Error();
      setLixeira((d.prazos as Prazo[])
        .filter(p => !p.lastMovedBy?.startsWith('Robô'))
        .sort((a, b) => (b.lastMovedAt || '').localeCompare(a.lastMovedAt || '')));
    } catch { setLixeira(null); showToast('Erro ao abrir a lixeira.', 'error'); }
  };
  const restaurar = async (p: Prazo) => {
    try {
      // O backend decide entre PENDENTE e "a confirmar" (card que nunca teve data fatal)
      const r = await apiFetch(`${API}/api/prazos/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PENDENTE', lastMovedBy: defaultMover || 'x' }),
      });
      if (!(await r.json()).success) throw new Error();
      setLixeira(l => l && l.filter(x => x.id !== p.id));
      showToast(`"${p.title}" voltou para o quadro.`, 'success');
      carregar();
    } catch { showToast('Erro ao restaurar.', 'error'); }
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

  // O botão "Concluir" chama direto (um clique); o arraste passa pelo modal de confirmação
  const confirmarMovimentacao = async (mov: NonNullable<typeof moveModal>) => {
    try {
      const r = await apiFetch(`${API}/api/prazos/${mov.prazo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // lastMovedBy preenchido = "foi um arraste"; o backend grava o usuário autenticado
        body: JSON.stringify({ status: mov.targetStatus, lastMovedBy: defaultMover || 'x' }),
      });
      const d = await r.json();
      if (d.success) {
        showToast(mov.targetStatus === 'CUMPRIDO' ? 'Prazo concluído!' : 'Prazo reaberto!', 'success');
        setMoveModal(null);
        carregar();
      } else {
        showToast('Erro ao mover prazo.', 'error');
      }
    } catch {
      showToast('Erro de conexão.', 'error');
    }
  };

  // O backend decide: card que nunca teve data fatal volta para "a confirmar" (statusAoReabrir)
  const desfazerConclusao = (prazo: NonNullable<typeof moveModal>['prazo']) =>
    confirmarMovimentacao({ prazo, targetStatus: 'PENDENTE' });

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
        // errors vem como [{ titulo, erro }] — join direto imprimia "[object Object]"
        const falhas = d.errors?.length
          ? ` · ${d.errors.length} linha(s) com erro: ${d.errors.slice(0, 2).map((e: { titulo: string; erro: string }) => `${e.titulo} (${e.erro})`).join('; ')}`
          : '';
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
  const editandoTriagem = Boolean(editingId && groups.triagem?.some(p => p.id === editingId));

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

  // Quadro: busca + filtros combináveis (aba "Filtros") valem para todas as colunas.
  type FiltroQuadro = { key: string; label: string; de: (p: Prazo) => string; rotulo: (k: string) => string; ordem?: readonly string[]; alfa?: boolean; fixas?: readonly string[]; largo?: boolean };
  const FILTROS_QUADRO: FiltroQuadro[] = [
    { key: 'tipo', label: 'Tipo', de: p => tipoBucket({ tipoDocumento: origemDe(p).tipo }), rotulo: k => INT_COLUMNS.find(c => c.key === k)?.label || k, ordem: INT_COLUMNS.map(c => c.key) },
    { key: 'area', label: 'Área', rotulo: k => AREAS.find(a => a.key === k)?.label || k, ordem: AREAS.map(a => a.key), de: areaDoPrazo },
    { key: 'tribunal', label: 'Tribunal', de: p => chaveTribunal(origemDe(p).tribunal), rotulo: k => (k === 'SEM' ? 'Sem tribunal' : k) },
    { key: 'prioridade', label: 'Prioridade', de: p => p.prioridade || 'SEM', rotulo: k => PRIORIDADES.find(x => x.key === k)?.label || 'Sem prioridade', ordem: [...PRIORIDADES.map(x => x.key), 'SEM'], fixas: [...PRIORIDADES.map(x => x.key), 'SEM'] },
    { key: 'jurisdicao', label: 'Jurisdição', de: p => origemDe(p).jurisdicao, rotulo: k => (k === 'SEM' ? 'Sem jurisdição' : k), alfa: true, fixas: JURISDICOES, largo: true },
  ];
  const passaFiltros = (p: Prazo, exceto?: string) =>
    FILTROS_QUADRO.every(f => f.key === exceto || !filtrosQuadro[f.key]?.length || filtrosQuadro[f.key].includes(f.de(p)));
  const naBuscaQuadro = (p: Prazo) =>
    !buscaQuadro.trim() || buscaMatch({ numeroProcesso: p.caseReference, clienteExtraido: p.title }, buscaQuadro);
  const filtraPrazo = (p: Prazo) => naBuscaQuadro(p) && passaFiltros(p);
  const basePrazos = COLUMNS.flatMap(c => groups[c.key] || []).filter(naBuscaQuadro);
  // Opções de um filtro com contagem que já respeita os demais filtros (igual à caixa)
  const opcoesFiltro = (f: FiltroQuadro) => {
    const n = new Map<string, number>();
    basePrazos.filter(p => passaFiltros(p, f.key)).forEach(p => { const k = f.de(p); n.set(k, (n.get(k) || 0) + 1); });
    [...(f.fixas || []), ...(filtrosQuadro[f.key] || [])].forEach(k => { if (!n.has(k)) n.set(k, 0); });
    const pos = (k: string) => f.ordem!.indexOf(k);
    return [...n.entries()]
      .sort((a, b) => (f.ordem ? pos(a[0]) - pos(b[0]) : f.alfa ? a[0].localeCompare(b[0], 'pt') : b[1] - a[1] || f.rotulo(a[0]).localeCompare(f.rotulo(b[0]))))
      .map(([key, qtd]) => ({ key, label: f.rotulo(key), n: qtd }));
  };
  const filtrosAtivos = FILTROS_QUADRO.filter(f => filtrosQuadro[f.key]?.length);
  const nFiltros = filtrosAtivos.length;
  const marcadosFiltro = (key: string) => filtrosQuadro[key] || [];
  const alternarFiltro = (key: string, valor: string) => setFiltrosQuadro(fs => {
    const atual = fs[key] || [];
    return { ...fs, [key]: atual.includes(valor) ? atual.filter(v => v !== valor) : [...atual, valor] };
  });
  const limparFiltro = (key: string) => setFiltrosQuadro(fs => ({ ...fs, [key]: [] }));
  // "Todos" | "Cáceres" | "Cáceres +2"
  const resumoFiltro = (f: FiltroQuadro) => {
    const v = marcadosFiltro(f.key);
    return !v.length ? 'Todos' : f.rotulo(v[0]) + (v.length > 1 ? ` +${v.length - 1}` : '');
  };

  // Colunas do quadro: urgência (vencido / hoje / semana / futuro / concluído)
  type ColQuadro = { key: string; label: string; cor: string; empty: string; itens: Prazo[]; porPrioridade?: boolean };
  const COR_TEMPO: Record<string, string> = { triagem: 'var(--urg-triagem)', vencido: 'var(--urg-vencido)', hoje: 'var(--urg-hoje)', semana: 'var(--urg-semana)', futuro: 'var(--urg-futuro)', concluido: 'var(--urg-ok)' };
  const colunasQuadro: ColQuadro[] = COLUMNS.map(c => {
    const itens = (groups[c.key] || []).filter(filtraPrazo);
    // Vencidos agrupados por prioridade quando alguém definiu prioridade
    const porPrioridade = c.key === 'vencido' && itens.some(p => p.prioridade);
    const cor = itens.length === 0 && c.key !== 'concluido' ? 'var(--urg-futuro)' : COR_TEMPO[c.key];
    return { key: c.key, label: c.label, cor, empty: c.empty, itens: porPrioridade ? ordenarPorPrioridade(itens) : itens, porPrioridade };
  });

  const PRIO_COR: Record<string, string> = { ALTA: '#b91c1c', MEDIA: '#b45309', BAIXA: '#667085', '': '#98a2b3' };
  const rotuloPrio = (k?: string | null) => PRIORIDADES.find(x => x.key === k)?.label;

  const cardPrazo = (p: Prazo) => {
    const origem = p.intimacoes?.[0];
    const movido = p.lastMovedBy ? `movido por ${p.lastMovedBy}${p.lastMovedAt ? ` · ${formatDate(p.lastMovedAt)}` : ''}` : undefined;
    return (
      <div
        key={p.id}
        className={`prazo-card ${p.bucket === 'concluido' ? 'prazo-card--done' : ''}`}
        draggable
        // setData é obrigatório: sem dado no dragstart o Firefox nem inicia o arraste
        onDragStart={e => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(p); }}
        onClick={() => setInfoCard(p)}
        onKeyDown={e => { if (e.key === 'Enter') setInfoCard(p); }}
        role="button"
        tabIndex={0}
        title={movido}
      >
        <div className="prazo-card-head">
          <span className="prazo-card-title">{p.title}</span>
          {rotuloPrio(p.prioridade) && <span className={`prazo-prio prazo-prio--${p.prioridade!.toLowerCase()}`}>{rotuloPrio(p.prioridade)}</span>}
        </div>
        {p.caseReference && <div className="prazo-card-case">{p.caseReference}</div>}
        {caminhoPje(p.origemPje) && <div className="prazo-card-pje" title={`Onde estava no Painel do Advogado do PJe: ${caminhoPje(p.origemPje)}`}>PJe: {caminhoPje(p.origemPje)}</div>}
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
            <button type="button" className="prazo-card-editar" title="Editar prazo"
              onClick={e => { e.stopPropagation(); abrirEdicao(p); }}>
              Editar prazo
            </button>
            {(origem?.tribunal || p.origemPje?.tribunal) && <span className="prazo-tag">{origem?.tribunal || p.origemPje?.tribunal}</span>}
          </div>
          <div className="prazo-card-acoes">
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
            {/* Com texto: só o ✓ não dizia o que fazia */}
            {p.bucket !== 'concluido' && (
              <button type="button" className="prazo-icon-btn prazo-card-ok" title="Marcar como cumprido"
                onClick={e => { e.stopPropagation(); confirmarMovimentacao({ prazo: p, targetStatus: 'CUMPRIDO' }); }}>
                <Check size={14} /> Concluir
              </button>
            )}
            {p.bucket === 'concluido' && (
              <button type="button" className="prazo-icon-btn prazo-card-ok" title="Desfazer a conclusão (volta para pendente)"
                onClick={e => { e.stopPropagation(); desfazerConclusao(p); }}>
                <Undo2 size={14} /> Desfazer
              </button>
            )}
          </div>
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
          {/* ── Quadro: título, visão e resumo · busca, prioridade, mais, novo ── */}
          <div className="prazo-topo">
            <div className="prazo-topo-acoes">
              <div className="prazo-busca">
                <Search size={14} />
                <input value={buscaQuadro} onChange={e => setBuscaQuadro(e.target.value)} placeholder="Buscar processo ou cliente…" aria-label="Buscar prazo por processo ou cliente" />
                {buscaQuadro && <button type="button" className="prazo-busca-limpar" onClick={() => setBuscaQuadro('')} title="Limpar busca"><X size={14} /></button>}
              </div>
              {dbUser?.id && segmento<typeof recorte>([
                ['meus', <>Meus <span className="prazo-seg-n">{nRecorte('meus')}</span></>],
                ['semDono', <>Sem dono <span className="prazo-seg-n">{nRecorte('semDono')}</span></>],
                ['todos', <>Todos <span className="prazo-seg-n">{totalTodos}</span></>],
              ] as const, recorte, setRecorte, 'Recorte do quadro')}
              {filtrosAtivos.map(f => (
                <button key={f.key} type="button" className="prazo-chip prazo-chip--on" title="Remover este filtro" onClick={() => limparFiltro(f.key)}>
                  {f.label}: {resumoFiltro(f)} <X size={12} />
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
                      <div key={f.key} className={`prazo-fp-campo ${f.largo ? 'prazo-fp-campo--largo' : ''} ${marcadosFiltro(f.key).length ? 'prazo-fp-campo--on' : ''}`}>
                        <span className="prazo-fp-rotulo">{f.label}</span>
                        {/* name: abrir um fecha os outros (accordion nativo) */}
                        <details name="prazo-fp" className="prazo-fp-multi">
                          <summary title={marcadosFiltro(f.key).map(f.rotulo).join(', ')}>{resumoFiltro(f)}</summary>
                          <div className="prazo-fp-opcoes">
                            {opcoesFiltro(f).map(o => (
                              <label key={o.key} className="prazo-fp-opcao">
                                <input type="checkbox" checked={marcadosFiltro(f.key).includes(o.key)} onChange={() => alternarFiltro(f.key, o.key)} />
                                <span>{o.label}</span><small>{o.n}</small>
                              </label>
                            ))}
                          </div>
                        </details>
                      </div>
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
                    <button type="button" role="menuitem" className="prazo-menu-item" onClick={() => { setMenu(null); abrirLixeira(); }}>
                      <Trash2 size={14} /> Lixeira
                    </button>
                    {isAdmin && (
                      <button type="button" role="menuitem" className="prazo-menu-item" onClick={() => { setMenu(null); setPerfisOpen(true); }}>
                        <Users size={14} /> Equipe e acessos
                      </button>
                    )}
                  </div>
                )}
              </div>
              <span className="prazo-pje-info"
                title={`Os prazos do PJe são lidos pelo robô no PC de quem tem o certificado (06:40 e 12:40, dias úteis). Última leitura: ${ultimaLeituraPje}.`}>
                <CalendarClock size={14} /> PJe: {ultimaLeituraPje}
              </span>
              <button type="button" className="prazo-btn prazo-btn--ghost" onClick={sincronizarDjen} disabled={syncing}
                title="Busca as intimações publicadas no DJEN; cada uma vira card no quadro">
                {syncing ? <Loader2 className="lx-spin" size={14} /> : <RefreshCw size={14} />}
                {syncing ? 'Consultando DJEN…' : 'Buscar no DJEN'}
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
                  {/* Desativado não recebe prazo novo; o atual dele continua aparecendo */}
                  {opcoesEquipe.filter(u => u.ativo !== false || u.id === form.responsibleId)
                    .map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
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

      {/* Dados do card + teor e certidão das intimações (o que antes só a caixa de intimações mostrava) */}
      {infoCard && (
        <div className="prazo-modal-overlay" onClick={() => setInfoCard(null)}>
          <div className="prazo-modal prazo-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="prazo-modal-header">
              <h3>{infoCard.title}</h3>
              <button className="prazo-icon-btn" title="Fechar" onClick={() => setInfoCard(null)}><X size={18} /></button>
            </div>
            <div className="prazo-form">
              <p className="prazo-move-desc"><strong>Processo:</strong> {infoCard.caseReference || 'não informado'}</p>
              <p className="prazo-move-desc"><strong>Onde estava no Painel do Advogado do PJe:</strong> {caminhoPje(infoCard.origemPje) || 'não veio do PJe'}</p>
              {/* No "a confirmar" a data é a publicação, não um prazo */}
              <p className="prazo-move-desc"><strong>{infoCard.status === 'A_CONFIRMAR' ? 'Publicado em' : 'Prazo limite'}:</strong> {formatDate(infoCard.fatalDate)}</p>
              {infoCard.description && <p className="prazo-move-desc" style={{ whiteSpace: 'pre-line' }}><strong>Observações:</strong> {infoCard.description}</p>}
              {infoInts === null ? (
                <div className="prazo-loading"><Loader2 className="lx-spin" size={20} /></div>
              ) : infoInts.length === 0 ? (
                <p className="prazo-move-desc">Sem intimação do DJEN ligada a este card.</p>
              ) : (
                // O DJEN publica o mesmo ato uma vez por destinatário: mostra cada teor uma vez só
                [...new Map(infoInts.map(i => [i.texto || i.id, i])).values()].map(i => (
                  <div key={i.id} className="prazo-info-int">
                    <div className="prazo-info-int-head">
                      <strong>{i.tipoDocumento || i.tipoComunicacao || 'Intimação'}</strong>
                      {[i.tribunal, i.dataDisponibilizacao && formatDate(i.dataDisponibilizacao)].filter(Boolean).join(' · ')}
                      {(i.hash || linkSeguro(i.link)) && (
                        <a href={i.hash ? `${API_DJEN}/${i.hash}/certidao` : linkSeguro(i.link)} target="_blank" rel="noopener noreferrer"
                          title={i.hash ? 'Certidão oficial da publicação (PDF)' : 'Abrir no PJe do tribunal'}>
                          {i.hash ? 'Abrir certidão' : 'Abrir no tribunal'} <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                    {i.texto && <div className="prazo-info-int-texto">{i.texto}</div>}
                  </div>
                ))
              )}
            </div>
            <div className="prazo-modal-footer">
              <button className="lx-btn-tool" onClick={() => setInfoCard(null)} autoFocus>Fechar</button>
            </div>
          </div>
        </div>
      )}

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
              <button className="lx-btn-primary" onClick={() => confirmarMovimentacao(moveModal)} autoFocus>
                <Check size={16} /> Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lixeira: cards excluídos, com quem excluiu e quando */}
      {lixeira && (
        <div className="prazo-modal-overlay" onClick={() => setLixeira(null)}>
          <div className="prazo-modal prazo-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="prazo-modal-header">
              <h3>Lixeira</h3>
              <button className="prazo-icon-btn" title="Fechar" onClick={() => setLixeira(null)}><X size={18} /></button>
            </div>
            <div className="prazo-form">
              {lixeira.length === 0 ? (
                <p className="prazo-move-desc">Nenhum prazo excluído.</p>
              ) : lixeira.map(p => (
                <div key={p.id} className="prazo-lixeira-item">
                  <div>
                    <strong>{p.title}</strong>
                    {p.caseReference && <small>{p.caseReference}</small>}
                    <small>excluído{p.lastMovedBy ? ` por ${p.lastMovedBy}` : ''}{p.lastMovedAt ? ` em ${formatDate(p.lastMovedAt)}` : ''}</small>
                  </div>
                  <button type="button" className="prazo-btn prazo-btn--ghost" onClick={() => restaurar(p)}>
                    <Undo2 size={14} /> Restaurar
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Perfis do quadro (admin) */}
      {perfisOpen && isAdmin && (
        <div className="prazo-modal-overlay" onClick={() => !salvandoPerfil && setPerfisOpen(false)}>
          <div className="prazo-modal prazo-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="prazo-modal-header">
              <h3>Equipe e acessos</h3>
              <button className="prazo-icon-btn" title="Fechar" onClick={() => setPerfisOpen(false)}><X size={18} /></button>
            </div>
            <div className="prazo-form">
              <p className="prazo-import-hint">
                Quem sai do escritório: <strong>Desativar</strong> (não entra mais e é desconectado na hora; os prazos ficam).
                Para redefinir a senha de alguém, cadastre de novo o mesmo e-mail com a senha nova.
                {!marcados.length && ' Marcados no quadro: enquanto ninguém for marcado, aparece a equipe toda.'}
              </p>
              <div className="prazo-perfis">
                {opcoesEquipe.map(u => (
                  <div key={u.id} className={`prazo-perfil ${u.ativo === false ? 'prazo-perfil--inativo' : ''}`}>
                    <input type="checkbox" checked={!!u.noQuadro} title="No quadro" aria-label={`${u.name || u.email} no quadro`}
                      onChange={e => marcarNoQuadro(u, e.target.checked)} />
                    {avatar(u.id)}
                    <span className="prazo-envio-nome">
                      {u.name || u.email}{u.ativo === false && ' (desativado)'}
                      {u.name && <small>{u.email}</small>}
                    </span>
                    {u.id !== dbUser?.id && (
                      <button type="button" className="prazo-btn prazo-btn--ghost prazo-btn--perfil" onClick={() => marcarAtivo(u, u.ativo === false)}>
                        {u.ativo === false ? 'Reativar' : 'Desativar'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <form
                className="prazo-perfil-novo"
                onSubmit={e => { e.preventDefault(); if (novoPerfil.name.trim() && novoPerfil.email.trim() && novoPerfil.senha.length >= 8) adicionarPerfil(); }}
              >
                <span className="prazo-perfis-titulo">Adicionar pessoa (ou redefinir senha)</span>
                <input type="text" placeholder="Nome" aria-label="Nome" value={novoPerfil.name}
                  onChange={e => setNovoPerfil(n => ({ ...n, name: e.target.value }))} />
                <input type="email" placeholder="E-mail de login" aria-label="E-mail de login" value={novoPerfil.email}
                  onChange={e => setNovoPerfil(n => ({ ...n, email: e.target.value }))} />
                <input type="password" autoComplete="new-password" placeholder="Senha inicial (mín. 8)" aria-label="Senha inicial" value={novoPerfil.senha}
                  onChange={e => setNovoPerfil(n => ({ ...n, senha: e.target.value }))} />
                <button type="submit" className="lx-btn-primary" disabled={salvandoPerfil || !novoPerfil.name.trim() || !novoPerfil.email.trim() || novoPerfil.senha.length < 8}>
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
