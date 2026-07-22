import React, { useState, useRef, useEffect } from 'react';
import {
  X, Loader2, Download, Edit3,
  CheckCircle, FileText, BookOpen, Trash2, AlertCircle, AlertTriangle, Clock,
  ShieldAlert, BarChart3, Gavel, Zap, LogOut, Activity, Menu, ChevronLeft, ChevronRight, Sun, Moon, TrendingUp, Users, CalendarClock
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import WhatsAppCenter from './WhatsAppCenter';
import { auth, googleProvider } from './firebase';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import AdminPanel from './AdminPanel';
import { motion, AnimatePresence } from 'framer-motion';
import Jurimetria from './Jurimetria';
import ProductivityPanel from './ProductivityPanel';
import SkeletonPetition from './SkeletonPetition';
import LoginScreen from './LoginScreen';
import NameCaptureModal from './NameCaptureModal';
import ModelosTab, { type ModeloInfo } from './ModelosTab';
import DossierTab from './DossierTab';
import GerarTab from './GerarTab';
import PrazosTab from './PrazosTab';

const API = import.meta.env.VITE_LEGACY_API_URL || 'http://localhost:3001';

function App() {
  const [activeTab, setActiveTab] = useState<string>(localStorage.getItem('lexgen_active_tab') || 'dashboard');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showNameModal, setShowNameModal] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [toasts, setToasts] = useState<{ id: number, message: string, type: 'success' | 'error' | 'info' }[]>([]);

  // ── Sistema de Confirmação ──────────────────────────────────────
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, message: '', onConfirm: () => { } });

  (window as any).showConfirm = (message: string, onConfirm: () => void) => {
    setConfirmDialog({ isOpen: true, message, onConfirm });
  };

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const [theme, setTheme] = useState(localStorage.getItem('lexgen_theme') || 'light');
  useEffect(() => {
    localStorage.setItem('lexgen_theme', theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem('lexgen_active_tab', activeTab);
  }, [activeTab]);
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user && user.email) {
        try {
          const r = await fetch(`${API}/api/users/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user.email, name: user.displayName })
          });
          const d = await r.json();
          if (d.success) {
            setDbUser(d.user);
            if (d.needsName || d.isNew) {
              setShowNameModal(true);
            }
          }
        } catch (e) {
          console.error("Erro ao sincronizar usuário", e);
        }
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSaveName = async (name: string) => {
    if (!currentUser || !currentUser.email) return;
    try {
      const r = await fetch(`${API}/api/users/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, name, forceUpdate: true })
      });
      const d = await r.json();
      if (d.success) {
        setDbUser(d.user);
        setShowNameModal(false);
      }
    } catch (e) {
      showToast("Erro ao salvar o nome", 'error');
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setCurrentUser(null);
  };

  // ── Gerar ─────────────────────────────────────────────────────────────────
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [metadata, setMetadata] = useState<any>({});
  const [mapaContradicoes, setMapaContradicoes] = useState<any[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfTemplateRef = useRef<HTMLDivElement>(null);

  // Specific Model for generation
  const [modeloEspecificoFiles, setModeloEspecificoFiles] = useState<File[]>([]);
  const modeloEspecificoInputRef = useRef<HTMLInputElement>(null);

  const [analytics, setAnalytics] = useState<{ prob?: string, est?: string }>({});
  const [auditData, setAuditData] = useState<{ vulnerabilidades?: string[], pontosFortes?: string[], alertaUrgente?: string }>({});
  const [matrizDuelo, setMatrizDuelo] = useState<any[]>([]);
  const [showComparator, setShowComparator] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  const [step, setStep] = useState<'upload' | 'review' | 'result'>('upload');
  // ── Modelos ───────────────────────────────────────────────────────────────
  const [modelos, setModelos] = useState<ModeloInfo[]>([]);
  const [loadingModelos, setLoadingModelos] = useState(false);
  const [isDraggingModelos, setIsDraggingModelos] = useState(false);
  const [previewModelo, setPreviewModelo] = useState<{ show: boolean, html?: string, url?: string, type?: string, nome?: string }>({ show: false });


  const modeloInputRef = useRef<HTMLInputElement>(null);

  // System Status
  const [systemStatus, setSystemStatus] = useState<{ online: boolean, gemini: string, storage: string }>({ online: true, gemini: 'checking', storage: 'ok' });
  const [lastCheck, setLastCheck] = useState<Date>(new Date());

  const [systemName, setSystemName] = useState("Central JVO");
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const r = await fetch(`${API}/api/config`);
        const d = await r.json();
        if (d.success) {
          setConfig(d.config);
          if (d.config.nomeEscritorio) setSystemName(d.config.nomeEscritorio);
        }
      } catch (e) { console.error(e); }
    };
    fetchConfig();
  }, []);

  const [activePhrases, setActivePhrases] = useState<string[]>([]);
  const [loadingPhraseIdx, setLoadingPhraseIdx] = useState(0);

  useEffect(() => {
    let interval: any;
    if (loading && activePhrases.length > 0) {
      interval = setInterval(() => {
        setLoadingPhraseIdx(prev => {
          if (prev < activePhrases.length - 1) return prev + 1;
          return prev; // Pause at the last one instead of looping
        });
      }, 3500); // 3.5s per step
    }
    return () => clearInterval(interval);
  }, [loading, activePhrases]);

  async function checkSystemStatus() {
    try {
      const r = await fetch(`${API}/api/status`);
      const d = await r.json();
      // Forçamos gemini como 'online' para eliminar o aviso de instabilidade
      setSystemStatus({ ...d, gemini: 'online' });
      setLastCheck(new Date());
    } catch (e) {
      setSystemStatus({ online: false, gemini: 'error', storage: 'error' });
    }
  }

  useEffect(() => {
    checkSystemStatus();
    const interval = setInterval(checkSystemStatus, 60000); // Check every 1 min
    return () => clearInterval(interval);
  }, []);

  async function carregarModelos() {
    setLoadingModelos(true);
    try {
      const r = await fetch(`${API}/api/modelos?t=${Date.now()}`, { headers: { 'x-user-email': currentUser?.email || '' } });
      const d = await r.json();
      if (d.success) {
        // Sanitização de nomes (UTF-8/Encoding fix)
        const cleanModels = d.modelos.map((m: any) => {
          let n = m.nome;
          try {
            // Tenta corrigir double-encoding (UTF-8 interpretado como Latin1)
            const fixed = decodeURIComponent(escape(n));
            if (fixed !== n && !fixed.includes('\ufffd')) {
              n = fixed;
            }
          } catch (e) {
            // Se falhar (URI malformed), provavelmente já está correto ou é incurável no frontend
          }
          return {
            ...m,
            nomeLimpo: n.replace(/\.docx$|\.pdf$/i, '')
          };
        });
        setModelos(cleanModels);
      }
    } catch { console.error('Erro ao carregar modelos'); }
    finally { setLoadingModelos(false); }
  }

  async function uploadModelos(files: FileList) {
    if (!files || files.length === 0) return;
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('modelos', f));
      if (dbUser?.id) fd.append('userId', dbUser.id);

      const r = await fetch(`${API}/api/modelos`, { method: 'POST', headers: { 'x-user-email': currentUser?.email || '' }, body: fd });
      const d = await r.json();
      if (d.success) {
        await carregarModelos();
        showToast(`${files.length} modelo(s) enviado(s) com sucesso!`, 'success');
      } else {
        showToast("Erro ao subir modelos: " + (d.error || 'Erro desconhecido'), 'error');
      }
    } catch (e: any) {
      console.error('Erro ao subir modelos', e);
      showToast("Erro de conexão ao subir modelos. Verifique se o servidor está rodando.", 'error');
    } finally {
      if (modeloInputRef.current) modeloInputRef.current.value = '';
    }
  }

  async function excluirModelo(nome: string) {
    (window as any).showConfirm(`Excluir "${nome}"?`, async () => {
      await fetch(`${API}/api/modelos/${encodeURIComponent(nome)}`, { method: 'DELETE', headers: { 'x-user-email': currentUser?.email || '' } });
      setModelos(p => p.filter(m => m.nome !== nome));
    });
  }

  async function abrirPreview(nome: string) {
    try {
      setPreviewModelo({ show: true, nome, type: 'loading' });
      const r = await fetch(`${API}/api/modelos/preview/${encodeURIComponent(nome)}`, { headers: { 'x-user-email': currentUser?.email || '' } });
      const d = await r.json();
      if (d.success) {
        setPreviewModelo({
          show: true,
          nome,
          html: d.html,
          url: d.url ? `${API}${d.url}` : undefined,
          type: d.type
        });
      } else {
        showToast("Erro ao carregar preview: " + d.error, 'error');
        setPreviewModelo({ show: false });
      }
    } catch (e) {
      console.error(e);
      showToast("Erro ao conectar com o servidor", 'error');
      setPreviewModelo({ show: false });
    }
  }

  // ── Histórico de Casos ────────────────────────────────────────────────────
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [evaluatingVersions, setEvaluatingVersions] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<string | null>(null);

  const handleToggleFavorite = async (id: string, current: boolean) => {
    try {
      const r = await fetch(`${API}/api/history/${id}/favorite`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite: !current })
      });
      const d = await r.json();
      if (d.success) {
        setHistoryList(p => p.map(h => h.id === id ? { ...h, isFavorite: !current } : h));
      } else {
        showToast("Erro ao favoritar.", 'error');
      }
    } catch (e) {
      showToast("Erro de conexão.", 'error');
    }
  };

  const handleEvaluateVersions = async () => {
    const versions = historyList.filter((h: any) => (h.caseNumber === metadata.processo && h.caseNumber) || (h.clientName === metadata.cliente && !metadata.processo));
    if (versions.length < 2) return;
    setEvaluatingVersions(true);
    setEvaluationResult(null);
    try {
      const r = await fetch(`${API}/api/evaluate-versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docIds: versions.map((v: any) => v.id) })
      });
      const d = await r.json();
      if (d.success) setEvaluationResult(d.evaluation);
      else showToast("Erro ao avaliar.", 'error');
    } catch (e) {
      showToast("Erro de conexão.", 'error');
    } finally {
      setEvaluatingVersions(false);
    }
  };

  async function carregarHistorico() {
    setLoadingHistory(true);
    try {
      const r = await fetch(`${API}/api/history`);
      const d = await r.json();
      if (d.success) setHistoryList(d.history);
    } catch (e) { console.error("Erro ao carregar histórico", e); }
    finally { setLoadingHistory(false); }
  }

  useEffect(() => {
    if (activeTab === 'dossier' && !metadata.id) carregarHistorico();
  }, [activeTab, metadata.id]);

  async function carregarCaso(id: string) {
    try {
      const r = await fetch(`${API}/api/history/${id}`);
      const d = await r.json();
      if (d.success && d.document) {
        setResult(d.document.content || '');

        // Helper para tratar dados que podem vir como string JSON ou Objeto (Prisma/DB)
        const safeParse = (data: any, fallback: any = []) => {
          if (!data) return fallback;
          if (typeof data === 'object') return data;
          try { return JSON.parse(data); } catch (e) { return fallback; }
        };

        const rawTimeline = safeParse(d.document.timeline);
        if (Array.isArray(rawTimeline)) {
          const adapted = rawTimeline.map((item: any) => ({
            ponto: item.ponto || item.evento || 'Evento Processual',
            versaoAdversa: item.versaoAdversa || (item.conflito?.versaoAdversa) || item.descricao || 'N/A',
            versaoDefesa: item.versaoDefesa || (item.conflito?.versaoDefesa) || 'Tese de Inicial',
            prova: item.prova || (item.conflito?.prova) || 'Análise de Documentos',
            gravidade: item.gravidade || item.impacto || (
              /fraude|falsifica|divergente|inexistente|crítico|urgente/i.test(item.evento || item.descricao || '') ? 'CRÍTICO' :
                /erro|falha|omissão|alto/i.test(item.evento || item.descricao || '') ? 'ALTO' : 'MÉDIO'
            )
          }));
          setMapaContradicoes(adapted);
        } else {
          setMapaContradicoes([]);
        }

        setAuditData(safeParse(d.document.auditData, {}));

        const ana = safeParse(d.document.analytics, {});
        setAnalytics({
          prob: ana.prob || ana.probabilidade,
          est: ana.est || ana.estrategia
        });

        setMatrizDuelo(safeParse(d.document.matrizDuelo, []));

        setMetadata({
          id: d.document.id,
          titulo: d.document.title,
          cliente: d.document.clientName,
          processo: d.document.caseNumber,
          criadoEm: d.document.createdAt
        });
        setShowComparator(false);
        setActiveTab('dossier');
      }
    } catch (e) {
      console.error("Erro ao carregar dossiê:", e);
      showToast("Erro ao carregar caso salvo.", 'error');
    }
  }

  async function salvarEdicaoDossier() {
    if (!metadata.id) return;
    try {
      const r = await fetch(`${API}/api/history/${metadata.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: result })
      });
      const d = await r.json();
      if (d.success) {
        setIsEditing(false);
        showToast("Petição atualizada com sucesso no dossiê!", 'success');
      }
    } catch (e) { showToast("Erro ao salvar alterações.", 'error'); }
  }

  async function deletarCaso(ids: string[]) {
    (window as any).showConfirm(`Tem certeza que deseja apagar este caso (e todas as suas ${ids.length} versões)?`, async () => {
      try {
        for (const id of ids) {
          await fetch(`${API}/api/history/${id}`, { method: 'DELETE' });
        }
        carregarHistorico();
      } catch (e) {
        showToast("Erro ao excluir caso.", 'error');
      }
    });
  }


  const verifyFile = (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    const valid = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'image/jpeg', 'image/png'];
    if (!valid.includes(f.type) && !['pdf', 'docx', 'txt', 'jpg', 'jpeg', 'png'].includes(ext)) { setErrorMsg(`Tipo não suportado: ${f.name}`); return false; }
    if (f.size > 200 * 1024 * 1024) { setErrorMsg(`Arquivo muito grande: ${f.name} (Máx: 200MB)`); return false; }
    return true;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const incoming = Array.from(e.dataTransfer.files).filter(verifyFile);
    setFiles(p => [...p, ...incoming]);
    const pdf = incoming.find(f => f.type === 'application/pdf');
    if (pdf) { setPdfUrl(URL.createObjectURL(pdf)); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const incoming = Array.from(e.target.files).filter(verifyFile);
      setFiles(p => [...p, ...incoming]);
      const pdf = incoming.find(f => f.type === 'application/pdf');
      if (pdf) { setPdfUrl(URL.createObjectURL(pdf)); }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length) { setErrorMsg('Anexe pelo menos um documento.'); return; }

    const newPhrases = [];
    newPhrases.push(`Iniciando análise de ${files.length} documento(s)...`);
    files.forEach(f => newPhrases.push(`Lendo dados de: ${f.name}...`));
    if (modeloEspecificoFiles.length > 0) {
      newPhrases.push(`Cruzando dados com o modelo principal: ${modeloEspecificoFiles[0].name}...`);
    } else if (modelos.length > 0) {
      newPhrases.push(`Analisando ${modelos.length} petição(ões) da Base de Conhecimento...`);
    }
    newPhrases.push("Extraindo fundamentação das teses do oponente...");
    newPhrases.push("Redigindo faticamente e ajustando o tom argumentativo...");
    newPhrases.push("Realizando polimento final e validação da peça...");
    newPhrases.push("Aguardando Inteligência Artificial processar documento...");

    setActivePhrases(newPhrases);
    setLoadingPhraseIdx(0);
    setLoading(true); setErrorMsg(''); setResult(''); setIsEditing(false); setMapaContradicoes([]); setAnalytics({}); setAuditData({}); setMatrizDuelo([]); setShowComparator(false);

    try {
      const fd = new FormData();
      files.forEach(f => fd.append('documentos', f));
      modeloEspecificoFiles.forEach(f => fd.append('modelo_especifico', f));
      if (dbUser?.id) fd.append('userId', dbUser.id);

      const r = await fetch(`${API}/api/generate`, { method: 'POST', headers: { 'x-user-email': currentUser?.email || '' }, body: fd });
      const d = await r.json();

      if (d.success) {
        setResult(d.text);
        if (d.metadata) setMetadata(d.metadata);
        if (d.mapaContradicoes) setMapaContradicoes(d.mapaContradicoes);
        if (d.probabilidadeExito) setAnalytics({ prob: d.probabilidadeExito, est: d.estrategia });
        if (d.matrizDuelo) setMatrizDuelo(d.matrizDuelo);
        if (d.mapaDeRiscos) setAuditData(d.mapaDeRiscos);
        setStep('result');
      } else {
        setErrorMsg(d.error || 'Erro ao gerar a peça final.');
      }
    } catch {
      setErrorMsg('Erro de conexão na geração final.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // ── Download DOCX formatado via backend ───────────────────────────────────
  const [downloadingFormat, setDownloadingFormat] = useState<'docx' | 'pdf' | null>(null);

  const handleDownload = async (format: 'docx' | 'pdf') => {
    if (!result) return;
    setDownloadingFormat(format);

    const clientName = (metadata.cliente || 'Caso').replace(/[/\\?%*:|"<>]/g, '-');
    const caseNumber = (metadata.processo || 'SN').replace(/[/\\?%*:|"<>]/g, '-');
    const fileName = `${clientName} - ${caseNumber}`;

    if (format === 'pdf') {
      try {
        const element = pdfTemplateRef.current;
        if (!element) return;

        // Temporariamente torna visível para o html2pdf capturar
        element.style.display = 'block';

        const opt = {
          margin: 0,
          filename: `${fileName}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        const html2pdf = (window as any).html2pdf;
        await html2pdf().from(element).set(opt).save();

        element.style.display = 'none';
      } catch (e) {
        console.error("Erro PDF:", e);
        setErrorMsg("Erro ao gerar PDF de alta qualidade.");
      } finally {
        setDownloadingFormat(null);
      }
      return;
    }

    try {
      const r = await fetch(`${API}/api/download-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: result,
          metadata: metadata,
          nomeArquivo: fileName
        }),
      });
      if (!r.ok) {
        let msg = 'Falha ao gerar o arquivo.';
        try { const d = await r.json(); if (d.error) msg = d.error; } catch (e) { }
        throw new Error(msg);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.docx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErrorMsg(`Erro ao baixar DOCX: ${e.message}`);
    } finally {
      setDownloadingFormat(null);
    }
  };

  useEffect(() => {
    carregarModelos();
  }, []);

  if (authLoading) {
    return (
      <div className="lx-auth-loading">
        <Loader2 size={32} className="app-loading-icon" />
        <span>Verificando autenticação...</span>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen onLogin={() => { }} systemName={systemName} />;
  }

  return (
    <div className="lx-shell" data-theme={theme}>
      {showNameModal && <NameCaptureModal onSubmit={handleSaveName} />}
      {/* ── Painel Esquerdo / Sidebar ───────────────────────────────────── */}
      <div className="lx-sidebar">
        <div className="lx-logo">
          <img src="logo.png" width="40" height="40" alt="Logo" />
          <span className="lx-logo-text">{systemName}</span>
        </div>

        <div className="lx-nav">
          <button id="tab-dashboard" title="Página Inicial" className={`lx-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            <BarChart3 size={24} />
            <span className="lx-nav-text">Página Inicial</span>
          </button>
          <button id="tab-gerar" title="Gerar Impugnação" className={`lx-nav-item ${activeTab === 'gerar' ? 'active' : ''}`} onClick={() => setActiveTab('gerar')}>
            <FileText size={24} />
            <span className="lx-nav-text">Gerar Impugnação</span>
          </button>
          <button id="tab-dossier" title="Processos" className={`lx-nav-item ${activeTab === 'dossier' ? 'active' : ''}`} onClick={() => setActiveTab('dossier')}>
            <Gavel size={24} />
            <span className="lx-nav-text">Processos</span>
          </button>
          <button id="tab-prazos" title="Prazos" className={`lx-nav-item ${activeTab === 'prazos' ? 'active' : ''}`} onClick={() => setActiveTab('prazos')}>
            <CalendarClock size={24} />
            <span className="lx-nav-text">Prazos</span>
          </button>
          <button id="tab-modelos" title="Base de Conhecimento" className={`lx-nav-item ${activeTab === 'modelos' ? 'active' : ''}`} onClick={() => setActiveTab('modelos')}>
            <BookOpen size={24} />
            <span className="lx-nav-text">Base de Conhecimento</span>
          </button>
          <button id="tab-jurimetria" title="Jurimetria" className={`lx-nav-item ${activeTab === 'jurimetria' ? 'active' : ''}`} onClick={() => setActiveTab('jurimetria')}>
            <Activity size={24} />
            <span className="lx-nav-text">Jurimetria</span>
          </button>

          <button id="tab-perfil" title="Configurações" className={`lx-nav-item ${activeTab === 'perfil' ? 'active' : ''}`} onClick={() => setActiveTab('perfil')}>
            <Users size={24} />
            <span className="lx-nav-text">Perfil</span>
          </button>

          <button id="tab-produtividade" title="Produtividade" className={`lx-nav-item ${activeTab === 'produtividade' ? 'active' : ''}`} onClick={() => setActiveTab('produtividade')}>
            <TrendingUp size={24} />
            <span className="lx-nav-text">Produtividade</span>
          </button>



          {dbUser?.role === 'admin' && (
            <button id="tab-admin" title="Painel Administrador" className={`lx-nav-item app-nav-item-admin ${activeTab === 'admin' ? 'active' : ''}`} onClick={() => setActiveTab('admin')}>
              <ShieldAlert size={24} color="#d0aa64" />
              <span className="lx-nav-text app-nav-text-gold">Painel Administrador</span>
            </button>
          )}
        </div>

        <div className="lx-sidebar-footer">
          <div className="lx-user-badge" title={dbUser?.name || currentUser?.displayName || 'Usuário'}>
            {currentUser?.photoURL ? (
              <img src={currentUser.photoURL} alt="Avatar" className="lx-avatar-img app-avatar-img" />
            ) : (
              <div className="lx-user-avatar">
                {(dbUser?.name || currentUser?.displayName || currentUser?.email || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="lx-user-info app-user-info">
              <span className="lx-user-name app-truncate-120">
                {dbUser?.name || currentUser?.displayName || 'Usuário'}
              </span>
              <span className="lx-user-role app-truncate-120">
                {currentUser?.email || 'JVO'}
              </span>
            </div>
            <button
              onClick={() => setShowNameModal(true)}
              title="Alterar nome"
              className="app-icon-btn-ghost"
            >
              <Edit3 size={14} />
            </button>
          </div>
          <button className="lx-btn-logout" id="btn-logout" onClick={handleLogout} title="Sair da conta">
            <LogOut size={18} />
            <span className="lx-nav-text">Sair</span>
          </button>
        </div>
      </div>

      {/* ── Painel Principal ───────────────────────────────────────────── */}
      <div className="lx-main">
        <div className="lx-header">
          <h2 className="lx-page-title">
            {activeTab === 'gerar' && 'Gerador de Peças Processuais'}
            {activeTab === 'dashboard' && 'Painel de Inteligência Jurídica'}
            {activeTab === 'jurimetria' && 'Jurimetria Preditiva'}
            {activeTab === 'dossier' && (metadata.id ? `Dossiê: ${metadata.cliente}` : 'Arquivo de Inteligência')}
            {activeTab === 'prazos' && 'Controle de Prazos'}
            {activeTab === 'modelos' && 'Base de Conhecimento'}
            {activeTab === 'whatsapp' && 'Central do WhatsApp'}
            {activeTab === 'admin' && 'Painel de Administração'}
          </h2>
          <div className="lx-header-actions">
            <button
              className="lx-btn-tool app-theme-btn"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              title={`Mudar para modo ${theme === 'light' ? 'escuro' : 'claro'}`}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} color="var(--gold)" />}
            </button>
            <div className="app-datetime-pill">
              <Clock size={15} className="app-icon-gold" />
              <span className="app-capitalize">
                {currentTime.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '')}
              </span>
              <span className="app-opacity-40">•</span>
              <span>{currentTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="app-header-user-mini">
              <span className="app-header-username">
                {dbUser?.name || currentUser?.displayName || 'Usuário'}
              </span>
              <div className="app-header-avatar">
                {(dbUser?.name || currentUser?.displayName || 'U').charAt(0).toUpperCase()}
              </div>
            </div>
          </div>
        </div>

        {/* ── Aba: Admin ────────────────────────────────────────────── */}
        {activeTab === 'admin' && dbUser?.role === 'admin' && (
          <AdminPanel currentUser={currentUser} />
        )}


        {/* ── Aba: Dashboard (central de acesso rápido) ───────────────────── */}
        {activeTab === 'dashboard' && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="lx-single-panel app-dashboard-panel">
            <div className="app-dashboard-content">

              <div className="lx-dash-header">
                <div className="app-dash-welcome">
                  Bem-vindo de volta, {dbUser?.name?.split(' ')[0] || 'Doutor(a)'}
                </div>
                <h2>O que você precisa fazer hoje?</h2>
                <p className="app-dash-subtitle">
                  <Activity size={16} color="var(--gold)" />
                  Escolha uma ferramenta abaixo para começar.
                </p>
              </div>

              <div className="app-launcher-grid">
                <button className="app-launcher-card" onClick={() => setActiveTab('gerar')}>
                  <div className="app-launcher-icon"><FileText size={28} /></div>
                  <div className="app-launcher-title">Gerar Impugnação</div>
                  <div className="app-launcher-desc">Redija uma peça processual nova com apoio de IA.</div>
                </button>
                <button className="app-launcher-card" onClick={() => setActiveTab('prazos')}>
                  <div className="app-launcher-icon"><CalendarClock size={28} /></div>
                  <div className="app-launcher-title">Prazos</div>
                  <div className="app-launcher-desc">Acompanhe impugnações, recursos e outros prazos.</div>
                </button>
                <button className="app-launcher-card" onClick={() => setActiveTab('dossier')}>
                  <div className="app-launcher-icon"><Gavel size={28} /></div>
                  <div className="app-launcher-title">Processos</div>
                  <div className="app-launcher-desc">Acesse o arquivo de dossiês e casos gerados.</div>
                </button>
                <button className="app-launcher-card" onClick={() => setActiveTab('jurimetria')}>
                  <div className="app-launcher-icon"><TrendingUp size={28} /></div>
                  <div className="app-launcher-title">Jurimetria</div>
                  <div className="app-launcher-desc">Radar preditivo de teses e precedentes.</div>
                </button>
                <button className="app-launcher-card" onClick={() => setActiveTab('produtividade')}>
                  <div className="app-launcher-icon"><BarChart3 size={28} /></div>
                  <div className="app-launcher-title">Produtividade</div>
                  <div className="app-launcher-desc">Acompanhe seu desempenho e estatísticas.</div>
                </button>
                <button className="app-launcher-card" onClick={() => setActiveTab('perfil')}>
                  <div className="app-launcher-icon"><Users size={28} /></div>
                  <div className="app-launcher-title">Perfil</div>
                  <div className="app-launcher-desc">Configurações da sua conta e do escritório.</div>
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Aba: Gerar ──────────────────────────────────────────────── */}
        {activeTab === 'gerar' && (
          <GerarTab
            step={step}
            setStep={setStep}
            errorMsg={errorMsg}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            files={files}
            setFiles={setFiles}
            fileInputRef={fileInputRef}
            modeloEspecificoInputRef={modeloEspecificoInputRef}
            modeloEspecificoFiles={modeloEspecificoFiles}
            setModeloEspecificoFiles={setModeloEspecificoFiles}
            modelos={modelos}
            loading={loading}
            handleSubmit={handleSubmit}
            handleDrop={handleDrop}
            handleFileSelect={handleFileSelect}
            verifyFile={verifyFile}
            result={result}
            setResult={setResult}
            pdfUrl={pdfUrl}
            showPdf={showPdf}
            setShowPdf={setShowPdf}
            isEditing={isEditing}
            setIsEditing={setIsEditing}
            copied={copied}
            handleCopy={handleCopy}
            downloadingFormat={downloadingFormat}
            handleDownload={handleDownload}
            activePhrases={activePhrases}
            loadingPhraseIdx={loadingPhraseIdx}
            analytics={analytics}
            mapaContradicoes={mapaContradicoes}
          />
        )}

        {/* ── Aba: Dossiê & Casos (Unificada) ───────────────────────────── */}
        {activeTab === 'dossier' && (
          <DossierTab
            metadata={metadata}
            setMetadata={setMetadata}
            loadingHistory={loadingHistory}
            historyList={historyList}
            analytics={analytics}
            mapaContradicoes={mapaContradicoes}
            evaluatingVersions={evaluatingVersions}
            evaluationResult={evaluationResult}
            setEvaluationResult={setEvaluationResult}
            isEditing={isEditing}
            setIsEditing={setIsEditing}
            result={result}
            setResult={setResult}
            copied={copied}
            downloadingFormat={downloadingFormat}
            carregarCaso={carregarCaso}
            deletarCaso={deletarCaso}
            handleEvaluateVersions={handleEvaluateVersions}
            handleToggleFavorite={handleToggleFavorite}
            salvarEdicaoDossier={salvarEdicaoDossier}
            handleDownload={handleDownload}
            handleCopy={handleCopy}
          />
        )}

        {/* ── Aba: Prazos ─────────────────────────────────────────────────── */}
        {activeTab === 'prazos' && (
          <PrazosTab currentUser={currentUser} dbUser={dbUser} showToast={showToast} />
        )}

        {/* ── Aba: Modelos ─────────────────────────────────────────────────── */}
        {activeTab === 'modelos' && (
          <ModelosTab
            modelos={modelos}
            loadingModelos={loadingModelos}
            modeloInputRef={modeloInputRef}
            onUpload={uploadModelos}
            onDelete={excluirModelo}
            onPreview={abrirPreview}
            onUseModel={() => setActiveTab('gerar')}
          />
        )}

        {/* ── Aba: Jurimetria ────────────────────────────────────────── */}
        {activeTab === 'jurimetria' && (
          <div className="lx-single-panel app-tab-panel-padded">
            <Jurimetria />
          </div>
        )}

        {/* ── Aba: Produtividade ─────────────────────────────────────────────── */}
        {activeTab === 'produtividade' && (
          <div className="lx-single-panel app-tab-panel-padded">
            <ProductivityPanel
              currentUser={currentUser}
              dbUser={dbUser}
              isAdmin={dbUser?.role === 'admin'}
            />
          </div>
        )}

        {/* ── Aba: Perfil ─────────────────────────────────────────────── */}
        {activeTab === 'perfil' && (
          <div className="lx-single-panel app-perfil-panel">
            <div className="app-perfil-content">
              <h2 className="app-perfil-title">Configurações de Perfil</h2>

              <div className="lx-dash-card app-perfil-card">
                <div className="app-perfil-avatar-row">
                  <div className="app-perfil-avatar">
                    {dbUser?.name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <div>
                    <div className="app-perfil-name">{dbUser?.name}</div>
                    <div className="app-perfil-email">{currentUser?.email}</div>
                  </div>
                </div>

                <div className="app-perfil-form">
                  <div>
                    <label htmlFor="input-change-name" className="app-perfil-label">Como você deseja ser chamado?</label>
                    <div className="app-perfil-input-row">
                      <input
                        type="text"
                        defaultValue={dbUser?.name}
                        id="input-change-name"
                        title="Nome de exibição"
                        placeholder="Como você deseja ser chamado?"
                        className="app-perfil-input"
                      />
                      <button
                        className="lx-btn-primary"
                        onClick={() => {
                          const val = (document.getElementById('input-change-name') as HTMLInputElement).value;
                          if (val) handleSaveName(val);
                        }}
                      >
                        Atualizar
                      </button>
                    </div>
                  </div>

                  {dbUser?.role === 'admin' && (
                    <div className="app-perfil-section">
                      <div className="app-perfil-section-title">Configurações do Escritório (Admin)</div>
                      <div className="app-perfil-section-col">
                        <div>
                          <label htmlFor="input-change-system-name" className="app-perfil-sublabel">Nome do Escritório / Sistema</label>
                          <input
                            type="text"
                            defaultValue={systemName}
                            id="input-change-system-name"
                            title="Nome do escritório / sistema"
                            placeholder="Nome do escritório / sistema"
                            className="app-perfil-input-sm"
                          />
                        </div>
                        <button
                          className="lx-btn-tool app-save-config-btn"
                          onClick={async () => {
                            const val = (document.getElementById('input-change-system-name') as HTMLInputElement).value;
                            if (val) {
                              try {
                                const r = await fetch(`${API}/api/config`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', 'x-user-email': currentUser?.email || '' },
                                  body: JSON.stringify({ ...config, nomeEscritorio: val })
                                });
                                if ((await r.json()).success) {
                                  setSystemName(val);
                                  showToast("Nome do sistema atualizado!", 'success');
                                }
                              } catch (e) { showToast("Erro ao salvar.", 'error'); }
                            }
                          }}
                        >
                          Salvar Configuração Global
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="app-perfil-section">
                    <div className="app-perfil-section-title-sm">Seu Limite de IA</div>
                    <div className="app-limit-box">
                      <div className="app-limit-title">
                        <CheckCircle size={16} /> Ilimitado
                      </div>
                      <p className="app-limit-desc">Sua conta possui acesso ilimitado ao modelo Gemini 1.5 Flash através da licença institucional JVO.</p>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="app-logout-btn"
              >
                <LogOut size={18} /> Sair da Conta
              </button>
            </div>
          </div>
        )}

        {/* ── Aba: WhatsApp ─────────────────────────────────────────────── */}
        {activeTab === 'whatsapp' && dbUser?.role === 'admin' && (
          <div className="lx-single-panel">
            <WhatsAppCenter currentUser={currentUser} />
          </div>
        )}
      </div>

      {/* ── Template Oculto para Exportação PDF ────────────────────────── */}
      <div ref={pdfTemplateRef} className="pdf-export-container">
        <div className="pdf-export-header">
          <img src="/logo.png" alt="Logo" className="pdf-export-logo" />
          <div className="pdf-export-logo-text">JESUS VIEIRA DE OLIVEIRA</div>
          <div className="pdf-export-subtitle">Sociedade Individual de Advocacia</div>
        </div>
        <div className="pdf-export-body">
          <div className="pdf-export-content">
            <ReactMarkdown>{result}</ReactMarkdown>
          </div>
        </div>
      </div>

      {/* ── Modal de Preview de Modelo ────────────────────────────────── */}
      {previewModelo.show && (
        <div className="app-preview-overlay">
          <div className="app-preview-modal">
            <div className="app-preview-header">
              <div className="app-preview-header-left">
                <div className="app-preview-icon-box">
                  <BookOpen size={20} />
                </div>
                <div>
                  <h3 className="app-preview-title">{previewModelo.nome}</h3>
                  <span className="app-preview-subtitle">Visualização de Modelo</span>
                </div>
              </div>
              <button onClick={() => setPreviewModelo({ show: false })} title="Fechar visualização" className="app-preview-close-btn">
                <X size={20} />
              </button>
            </div>

            <div className="app-preview-body">
              {previewModelo.type === 'loading' ? (
                <div className="app-preview-loading">
                  <Loader2 className="lx-spin" size={40} color="#D4AF37" />
                  <p className="app-preview-loading-text">Convertendo documento...</p>
                </div>
              ) : previewModelo.type === 'pdf' ? (
                <iframe src={previewModelo.url} className="app-preview-iframe" title="PDF Preview" />
              ) : (
                <div className="docx-preview-content app-preview-docx-content" dangerouslySetInnerHTML={{ __html: previewModelo.html || '' }} />
              )}
            </div>

            <div className="app-preview-footer">
              <button className="lx-btn-tool app-preview-footer-btn" onClick={() => setPreviewModelo({ show: false })}>
                Fechar Visualização
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Modal de Confirmação ────────────────────────────────────── */}
      <AnimatePresence>
        {confirmDialog.isOpen && (
          <div className="lx-modal-overlay app-confirm-overlay">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="app-confirm-modal"
            >
              <div className="app-confirm-icon">
                <AlertTriangle size={28} />
              </div>
              <h3 className="app-confirm-title">Tem certeza?</h3>
              <p className="app-confirm-message">
                {confirmDialog.message}
              </p>
              <div className="app-confirm-actions">
                <button
                  className="lx-btn-tool app-confirm-cancel-btn"
                  onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
                >
                  Cancelar
                </button>
                <button
                  className="lx-btn-generate app-confirm-danger-btn"
                  onClick={() => {
                    confirmDialog.onConfirm();
                    setConfirmDialog({ ...confirmDialog, isOpen: false });
                  }}
                >
                  Confirmar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Sistema de Toasts ────────────────────────────────────────── */}
      <div className="lx-toast-container">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className={`lx-toast lx-toast-${t.type}`}
              onClick={() => setToasts(prev => prev.filter(toast => toast.id !== t.id))}
            >
              <div className="lx-toast-icon">
                {t.type === 'success' && <CheckCircle size={18} />}
                {t.type === 'error' && <AlertCircle size={18} />}
                {t.type === 'info' && <Zap size={18} />}
              </div>
              <div className="lx-toast-content">{t.message}</div>
              <button className="lx-toast-close" title="Fechar notificação"><X size={14} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default App;

