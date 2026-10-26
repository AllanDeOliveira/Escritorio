import { useState, useEffect } from 'react';
import { Users, ShieldAlert } from 'lucide-react';

import { apiFetch, API } from './api';
import './AdminPanel.css';

export default function AdminPanel() {
  // null = ainda carregando ou falhou (mostra "—", nunca um "0" falso)
  const [users, setUsers] = useState<number | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    apiFetch(`${API}/api/admin/stats`)
      .then(r => r.json())
      .then(d => { if (d.success) setUsers(d.stats.users); else setErro(true); })
      .catch(err => { console.error("Erro ao buscar dados do admin:", err); setErro(true); });
  }, []);

  return (
    <div className="lx-single-panel admin-page">
      <div className="admin-content">

        <div className="admin-header">
          <ShieldAlert size={32} color="#d0aa64" />
          <div>
            <h2 className="admin-title">Painel de Controle</h2>
            <p className="admin-subtitle">Gerenciamento avançado do Central JVO</p>
          </div>
        </div>

        <div className="admin-stats-grid">
          <div className="lx-stat-card">
            <div className="lx-stat-icon-box"><Users size={24} /></div>
            <div className="lx-stat-value">{users ?? (erro ? '—' : '...')}</div>
            <div className="lx-stat-label">{erro ? 'Não foi possível carregar' : 'Usuários Autorizados'}</div>
          </div>
        </div>

      </div>
    </div>
  );
}
