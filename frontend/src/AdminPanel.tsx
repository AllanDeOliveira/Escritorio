import { useState, useEffect } from 'react';
import { Users, Loader2, Plus, Building2 } from 'lucide-react';

import { apiFetch, API, type Usuario } from './api';
import { iniciais } from './PrazosTab';
import './AdminPanel.css';

type Membro = { id: string; name?: string | null; email: string; ativo?: boolean; podeRodarRobo?: boolean };
type ShowToast = (m: string, t?: 'success' | 'error' | 'info') => void;

interface AdminPanelProps {
  dbUser: Usuario;
  showToast: ShowToast;
  nomeEscritorio: string;
  config: Record<string, unknown> | null;
  onNomeSalvo: (nome: string) => void;
}

/**
 * Administração: equipe e acessos (antes no menu ⋯ do quadro) e nome do escritório (antes no Perfil).
 * ponytail: "No quadro" ficou de fora — a visão "Por pessoa" saiu do quadro e o campo não tem efeito.
 */
export default function AdminPanel({ dbUser, showToast, nomeEscritorio, config, onNomeSalvo }: AdminPanelProps) {
  // null = ainda carregando ou falhou (mostra "—", nunca um "0" falso)
  const [users, setUsers] = useState<number | null>(null);
  const [erro, setErro] = useState(false);
  const [equipe, setEquipe] = useState<Membro[]>([]);
  const [novoPerfil, setNovoPerfil] = useState({ name: '', email: '', senha: '' });
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [nome, setNome] = useState(nomeEscritorio);
  const [salvandoNome, setSalvandoNome] = useState(false);

  useEffect(() => {
    apiFetch(`${API}/api/admin/stats`)
      .then(r => r.json())
      .then(d => { if (d.success) setUsers(d.stats.users); else setErro(true); })
      .catch(err => { console.error("Erro ao buscar dados do admin:", err); setErro(true); });
    apiFetch(`${API}/api/users`)
      .then(r => r.json())
      .then(d => { if (d.success) setEquipe(d.users); else showToast(d.error || 'Erro ao carregar a equipe.', 'error'); })
      .catch(() => showToast('Erro ao carregar a equipe.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PUT /api/users/:id/{robo|ativo} — atualiza a linha só se o servidor confirmar
  const alterar = async (u: Membro, rota: 'robo' | 'ativo', campo: 'podeRodarRobo' | 'ativo', valor: boolean) => {
    try {
      const r = await apiFetch(`${API}/api/users/${u.id}/${rota}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [campo]: valor }),
      });
      const d = await r.json();
      if (d.success) setEquipe(eq => eq.map(x => x.id === u.id ? { ...x, [campo]: valor } : x));
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

  const salvarNome = async () => {
    const val = nome.trim();
    if (!val) return;
    setSalvandoNome(true);
    try {
      const r = await apiFetch(`${API}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, nomeEscritorio: val }),
      });
      const d = await r.json();
      if (d.success) { onNomeSalvo(val); showToast('Nome do escritório atualizado.', 'success'); }
      else showToast(d.error || 'Não foi possível salvar o nome.', 'error');
    } catch { showToast('Erro de conexão ao salvar.', 'error'); }
    finally { setSalvandoNome(false); }
  };

  const podeAdicionar = novoPerfil.name.trim() && novoPerfil.email.trim() && novoPerfil.senha.length >= 8;

  return (
    <div className="lx-single-panel admin-page">
      <div className="admin-content">

        <div className="admin-stats-grid">
          <div className="lx-stat-card">
            <div className="lx-stat-icon-box"><Users size={24} /></div>
            <div className="lx-stat-value">{users ?? (erro ? '—' : '...')}</div>
            <div className="lx-stat-label">{erro ? 'Não foi possível carregar' : 'Usuários Autorizados'}</div>
          </div>
        </div>

        <section className="lx-dash-card admin-secao" aria-labelledby="admin-equipe">
          <h2 id="admin-equipe" className="admin-secao-titulo"><Users size={18} /> Equipe e acessos</h2>
          <ul className="admin-ajuda">
            <li><strong>Robô PJe:</strong> só para quem roda o robô no PC com o certificado. Desmarcar revoga os tokens da pessoa.</li>
            <li><strong>Desativar:</strong> para quem sai do escritório. A pessoa não entra mais e é desconectada na hora; os prazos dela ficam.</li>
            <li><strong>Redefinir senha:</strong> cadastre de novo o mesmo e-mail com a senha nova. Os tokens do robô da pessoa caem.</li>
          </ul>

          <div className="prazo-perfis admin-perfis">
            {equipe.map((u, idx) => (
              <div key={u.id} className={`prazo-perfil ${u.ativo === false ? 'prazo-perfil--inativo' : ''}`}>
                <span className={`prazo-av prazo-av--${idx % 4}`} aria-hidden="true">{iniciais(u.name || u.email)}</span>
                <span className="prazo-envio-nome">
                  {u.name || u.email}{u.ativo === false && ' (desativado)'}
                  {u.name && <small>{u.email}</small>}
                </span>
                <label className="prazo-perfil-robo">
                  <input type="checkbox" checked={!!u.podeRodarRobo} onChange={e => alterar(u, 'robo', 'podeRodarRobo', e.target.checked)} /> Robô PJe
                </label>
                {u.id === dbUser.id ? (
                  <span className="admin-voce">Você</span>
                ) : (
                  <button type="button" className="prazo-btn prazo-btn--ghost prazo-btn--perfil admin-acao" onClick={() => alterar(u, 'ativo', 'ativo', u.ativo === false)}>
                    {u.ativo === false ? 'Reativar' : 'Desativar'}
                  </button>
                )}
              </div>
            ))}
          </div>

          <form className="prazo-perfil-novo" onSubmit={e => { e.preventDefault(); if (podeAdicionar) adicionarPerfil(); }}>
            <span className="prazo-perfis-titulo">Adicionar pessoa (ou redefinir senha)</span>
            <input type="text" placeholder="Nome" aria-label="Nome" value={novoPerfil.name}
              onChange={e => setNovoPerfil(n => ({ ...n, name: e.target.value }))} />
            <input type="email" placeholder="E-mail de login" aria-label="E-mail de login" value={novoPerfil.email}
              onChange={e => setNovoPerfil(n => ({ ...n, email: e.target.value }))} />
            <input type="password" autoComplete="new-password" placeholder="Senha inicial (mín. 8)" aria-label="Senha inicial" value={novoPerfil.senha}
              onChange={e => setNovoPerfil(n => ({ ...n, senha: e.target.value }))} />
            <button type="submit" className="lx-btn-primary" disabled={salvandoPerfil || !podeAdicionar}>
              {salvandoPerfil ? <Loader2 className="lx-spin" size={14} /> : <Plus size={14} />} Adicionar
            </button>
          </form>
        </section>

        <section className="lx-dash-card admin-secao" aria-labelledby="admin-escritorio">
          <h2 id="admin-escritorio" className="admin-secao-titulo"><Building2 size={18} /> Escritório</h2>
          <form className="admin-nome" onSubmit={e => { e.preventDefault(); salvarNome(); }}>
            <label htmlFor="input-change-system-name" className="app-perfil-label">Nome do escritório (aparece no menu e na tela de login)</label>
            <div className="app-perfil-input-row">
              <input id="input-change-system-name" type="text" className="app-perfil-input" value={nome} onChange={e => setNome(e.target.value)} />
              <button type="submit" className="lx-btn-primary" disabled={salvandoNome || !nome.trim() || nome.trim() === nomeEscritorio}>
                {salvandoNome && <Loader2 className="lx-spin" size={14} />} Salvar nome
              </button>
            </div>
          </form>
        </section>

      </div>
    </div>
  );
}
