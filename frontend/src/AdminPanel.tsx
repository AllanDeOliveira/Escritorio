import React, { useState, useEffect } from 'react';
import { Settings, Users, Activity, Database, ShieldAlert, Key, Save } from 'lucide-react';

import WhatsAppCenter from './WhatsAppCenter';
import './AdminPanel.css';

export default function AdminPanel({ currentUser }: { currentUser: any }) {
  const [stats, setStats] = useState({ users: 0, models: 0, cases: 0 });
  const [userReports, setUserReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [promptLoading, setPromptLoading] = useState(true);
  const [savingPrompt, setSavingPrompt] = useState(false);

  useEffect(() => {
    const fetchAllData = async () => {
      try {
        const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const headers = { 'x-user-email': currentUser?.email || '' };
        const [resStats, resPrompt] = await Promise.all([
            fetch(`${API}/api/admin/stats`, { headers }),
            fetch(`${API}/api/admin/prompt`, { headers })
        ]);

        const dataStats = await resStats.json();
        if (dataStats.success) {
          setStats(dataStats.stats);
          setUserReports(dataStats.userReports || []);
        }

        const dataPrompt = await resPrompt.json();
        if (dataPrompt.success) setSystemPrompt(dataPrompt.prompt);

      } catch (err) {
        console.error("Erro ao buscar dados do admin:", err);
      } finally {
        setLoading(false);
        setPromptLoading(false);
      }
    };
    fetchAllData();
  }, []);

  const handleSavePrompt = async () => {
    setSavingPrompt(true);
    try {
        const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const res = await fetch(`${API}/api/admin/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-email': currentUser?.email || '' },
            body: JSON.stringify({ prompt: systemPrompt })
        });
        const data = await res.json();
        if (data.success) alert("Prompt do sistema salvo com sucesso!");
    } catch (err) {
        alert("Erro na conexão ao salvar o prompt.");
    } finally {
        setSavingPrompt(false);
    }
  };

  return (
    <div className="lx-single-panel admin-page">
      <div className="admin-content">

        <div className="admin-header">
          <ShieldAlert size={32} color="#d0aa64" />
          <div>
            <h2 className="admin-title">Painel de Controle</h2>
            <p className="admin-subtitle">Gerenciamento avançado do LexGen Workspace</p>
          </div>
        </div>

        <div className="admin-stats-grid">
          <div className="lx-stat-card">
            <div className="lx-stat-icon-box"><Users size={24} /></div>
            <div className="lx-stat-value">{loading ? '...' : stats.users}</div>
            <div className="lx-stat-label">Usuários Autorizados</div>
          </div>
          <div className="lx-stat-card">
            <div className="lx-stat-icon-box"><Database size={24} /></div>
            <div className="lx-stat-value">{loading ? '...' : stats.models}</div>
            <div className="lx-stat-label">Modelos Base Cadastrados</div>
          </div>
          <div className="lx-stat-card">
            <div className="lx-stat-icon-box"><Activity size={24} /></div>
            <div className="lx-stat-value">{loading ? '...' : stats.cases}</div>
            <div className="lx-stat-label">Total de Peças Geradas</div>
          </div>
        </div>

        {/* Automação WhatsApp */}
        <div className="admin-card">
          <div className="admin-card-header-row">
             <h3 className="admin-card-title">
               <Activity size={20} color="#25D366" /> Automação WhatsApp (Avisos e Audiências)
             </h3>
          </div>
          <WhatsAppCenter currentUser={currentUser} />
        </div>

        {/* Relatórios Individuais por Conta */}
        <div className="admin-card">
          <div className="admin-report-header">
            <Users size={20} color="var(--gold)" />
            <h3 className="admin-report-title">Relatórios de Contas Individuais</h3>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr className="admin-table-head-row">
                  <th className="admin-th">ADVOGADO</th>
                  <th className="admin-th">EMAIL</th>
                  <th className="admin-th-center">PEÇAS GERADAS</th>
                  <th className="admin-th-right">CADASTRO</th>
                </tr>
              </thead>
              <tbody>
                {userReports.length > 0 ? userReports.map((user: any) => (
                  <tr key={user.id} className="admin-tr">
                    <td className="admin-td-name">{user.name || 'Sem nome'}</td>
                    <td className="admin-td-email">{user.email}</td>
                    <td className="admin-td-center">
                      <span className="admin-badge">
                        {user.docCount}
                      </span>
                    </td>
                    <td className="admin-td-date">
                      {new Date(user.createdAt).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className="admin-empty-cell">
                      Nenhum relatório individual disponível.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Editor de Prompt */}
        <div className="admin-card admin-card--tight">
          <div className="admin-card-header-row">
             <h3 className="admin-card-title">
               <Settings size={20} color="#d0aa64" /> Editor de Prompt do Sistema
             </h3>
             <button className="lx-btn-primary admin-save-btn" onClick={handleSavePrompt} disabled={savingPrompt || promptLoading}>
                <Save size={16} /> {savingPrompt ? 'Salvando...' : 'Salvar Regras'}
             </button>
          </div>
          <p className="admin-prompt-desc">
            Altere as instruções base e regras processuais que a IA utiliza para redigir todas as petições.
          </p>
          <label htmlFor="system-prompt-textarea" className="admin-visually-hidden-label">Editor de prompt do sistema</label>
          <textarea
            id="system-prompt-textarea"
            title="Editor de prompt do sistema"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="admin-prompt-textarea"
          />
        </div>

      </div>
    </div>
  );
}
