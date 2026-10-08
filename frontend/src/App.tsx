import { useState, useEffect, useCallback } from 'react';
import {
  X, Loader2, Edit3, CheckCircle, AlertCircle, AlertTriangle, Clock,
  ShieldAlert, BarChart3, Zap, LogOut, Sun, Moon, Users, CalendarClock
} from 'lucide-react';
import { auth, apiFetch, API } from './firebase';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import AdminPanel from './AdminPanel';
import LoginScreen from './LoginScreen';
import NameCaptureModal from './NameCaptureModal';
import PrazosTab from './PrazosTab';
import DashboardTab, { resumoDePrazos, type Resumo, type SyncStatus, type PrazoLite } from './DashboardTab';

// Só contas do escritório (o servidor confere de novo; aqui é para não montar a tela à toa)
const DOMINIO = '@jvo.adv.br';

// localStorage pode lançar (janela privada do Safari, cota cheia) — nunca derruba a tela por isso
const lsGet = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem persistência */ } };

function App() {
  const [activeTab, setActiveTab] = useState<string>(() => {
    const salva = lsGet('lexgen_active_tab');
    return ['dashboard', 'prazos', 'perfil', 'admin'].includes(salva) ? salva : 'dashboard';
  });
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
    const id = Date.now() + Math.random(); // vários toasts no mesmo ms geravam key duplicada
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const [theme, setTheme] = useState(lsGet('lexgen_theme') || 'light');
  useEffect(() => { lsSet('lexgen_theme', theme); }, [theme]);
  useEffect(() => { lsSet('lexgen_active_tab', activeTab); }, [activeTab]);
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Conta de fora do domínio: sai antes de montar a tela (a LoginScreen mostra o aviso)
      if (user && !(user.email || '').toLowerCase().endsWith(DOMINIO)) {
        await signOut(auth);
        setAuthLoading(false);
        return;
      }
      setCurrentUser(user);
      if (!user) {
        // Logout ou troca de conta na mesma aba: nada do usuário anterior pode sobrar
        setDbUser(null);
        setShowNameModal(false);
        setResumo(null);
        setSync(null);
        setListaHoje([]);
        setListaSemana([]);
      }
      if (user && user.email) {
        try {
          const r = await apiFetch(`${API}/api/users/sync`, {
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
      const r = await apiFetch(`${API}/api/users/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email, name, forceUpdate: true })
      });
      const d = await r.json();
      if (d.success) {
        setDbUser(d.user);
        setShowNameModal(false);
      } else {
        showToast(d.error || "Erro ao salvar o nome", 'error');
      }
    } catch {
      showToast("Erro ao salvar o nome", 'error');
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setCurrentUser(null);
  };


  const [systemName, setSystemName] = useState("Central JVO");
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const r = await apiFetch(`${API}/api/config`);
        const d = await r.json();
        if (d.success) {
          setConfig(d.config);
          if (d.config.nomeEscritorio) setSystemName(d.config.nomeEscritorio);
        }
      } catch (e) { console.error(e); }
    };
    fetchConfig();
  }, []);


  // ── Resumo do Dashboard (situação do escritório) ─────────────────────────
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [resumoLoading, setResumoLoading] = useState(true);
  const [resumoErro, setResumoErro] = useState(false);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [listaHoje, setListaHoje] = useState<PrazoLite[]>([]);
  const [listaSemana, setListaSemana] = useState<PrazoLite[]>([]);
  const [syncing, setSyncing] = useState(false);
  // View inicial ao entrar na aba Prazos (deep-link do card de intimações → caixa)
  const [prazosInitialView, setPrazosInitialView] = useState<'board' | 'inbox'>('board');

  // Depende do dbUser (não do login do Firebase): o /sync precisa ter criado o usuário
  // antes, senão o primeiro acesso de alguém novo recebia 403 e abria em erro.
  const carregarResumo = useCallback(async () => {
    if (!dbUser?.id) return;
    setResumoLoading(true);
    // Números (prazos + intimações): se qualquer um falhar, resumo fica null e a UI
    // mostra erro — nunca "0 vencidos" falso, que esconderia um prazo perdido.
    try {
      const [pr, intr] = await Promise.all([
        apiFetch(`${API}/api/prazos`).then(r => r.json()),
        apiFetch(`${API}/api/intimacoes?status=NOVA`).then(r => r.json()),
      ]);
      if (!pr.success || !intr.success) throw new Error('resumo');
      // O backend já roda enrich() em cada prazo, então `bucket` vem pronto — o
      // digest sai de um filtro no array que já temos. Sem endpoint novo.
      const prazos = pr.prazos || [];
      // `novas` = intimações recebidas hoje (tudo vira card na hora, então "aguardando" é sempre 0)
      setResumo({ ...resumoDePrazos(prazos), novas: intr.counts?.hoje || 0 });
      setListaHoje(prazos.filter((p: any) => p.bucket === 'hoje'));
      setListaSemana(prazos.filter((p: any) => p.bucket === 'semana'));
      setSync(intr.syncStatus || null);
      setResumoErro(false);
    } catch {
      // Zera tudo junto: nada de "✓ sincronizado" ou lista de prazos ao lado de um erro.
      setResumo(null);
      setSync(null);
      setListaHoje([]);
      setListaSemana([]);
      setResumoErro(true);
    } finally {
      setResumoLoading(false);
    }
  }, [dbUser?.id]);

  // Busca no login (o badge da sidebar precisa do resumo em qualquer aba) + refresh a cada 5 min
  useEffect(() => {
    carregarResumo();
    const iv = setInterval(carregarResumo, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [carregarResumo]);

  // Reforça a atualização ao voltar para a home
  useEffect(() => {
    if (activeTab === 'dashboard') carregarResumo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Aba "admin" lembrada no navegador, mas a conta não é (mais) admin: cai para a home
  useEffect(() => {
    if (activeTab === 'admin' && dbUser && dbUser.role !== 'admin') setActiveTab('dashboard');
  }, [activeTab, dbUser]);

  // "Buscar agora" do banner de sync desatualizado. O resultado real vem do
  // carregarResumo() seguinte — inclusive um 409 (cron já rodando).
  const handleSyncNow = useCallback(async () => {
    if (!dbUser?.id) return;
    setSyncing(true);
    try {
      await apiFetch(`${API}/api/intimacoes/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch { /* o estado real aparece no carregarResumo abaixo */ }
    finally {
      setSyncing(false);
      await carregarResumo();
    }
  }, [dbUser?.id, carregarResumo]);

  const handleDashboardNavigate = (tab: string, opts?: { view?: 'board' | 'inbox' }) => {
    if (tab === 'prazos') setPrazosInitialView(opts?.view || 'board');
    setActiveTab(tab);
  };



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
          <button id="tab-prazos" title="Prazos" className={`lx-nav-item ${activeTab === 'prazos' ? 'active' : ''}`} onClick={() => { setPrazosInitialView('board'); setActiveTab('prazos'); }}>
            <CalendarClock size={24} />
            <span className="lx-nav-text">Prazos</span>
            {resumo && (resumo.vencido + resumo.hoje) > 0 && (
              <span className="lx-nav-badge" title={`${resumo.vencido + resumo.hoje} prazo(s) crítico(s)`}>
                {resumo.vencido + resumo.hoje}
              </span>
            )}
          </button>

          <button id="tab-perfil" title="Configurações" className={`lx-nav-item ${activeTab === 'perfil' ? 'active' : ''}`} onClick={() => setActiveTab('perfil')}>
            <Users size={24} />
            <span className="lx-nav-text">Perfil</span>
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
            {activeTab === 'dashboard' && 'Painel de Inteligência Jurídica'}
            {activeTab === 'prazos' && 'Controle de Prazos'}
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
                {currentTime.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')}
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
          <AdminPanel />
        )}


        {/* ── Aba: Dashboard (situação do escritório) ─────────────────────── */}
        {activeTab === 'dashboard' && (
          <DashboardTab
            resumo={resumo}
            loading={resumoLoading}
            erro={resumoErro}
            nomeUsuario={dbUser?.name || currentUser?.displayName || ''}
            onRefresh={carregarResumo}
            onNavigate={handleDashboardNavigate}
            sync={sync}
            onSyncNow={handleSyncNow}
            syncing={syncing}
            prazosHoje={listaHoje}
            prazosSemana={listaSemana}
          />
        )}


        {/* ── Aba: Prazos ─────────────────────────────────────────────────── */}
        {activeTab === 'prazos' && (
          <PrazosTab currentUser={currentUser} dbUser={dbUser} showToast={showToast} initialView={prazosInitialView} />
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
                                const r = await apiFetch(`${API}/api/config`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ ...config, nomeEscritorio: val })
                                });
                                if ((await r.json()).success) {
                                  setSystemName(val);
                                  showToast("Nome do sistema atualizado!", 'success');
                                }
                              } catch { showToast("Erro ao salvar.", 'error'); }
                            }
                          }}
                        >
                          Salvar Configuração Global
                        </button>
                      </div>
                    </div>
                  )}

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

      </div>

      {/* ── Modal de Confirmação ────────────────────────────────────── */}
        {confirmDialog.isOpen && (
          <div className="lx-modal-overlay app-confirm-overlay">
            <div className="app-confirm-modal lx-pop-in">
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
            </div>
          </div>
        )}

      {/* ── Sistema de Toasts ────────────────────────────────────────── */}
      <div className="lx-toast-container">
          {toasts.map(t => (
            <div
              key={t.id}
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
            </div>
          ))}
      </div>
    </div>
  );
}

export default App;

