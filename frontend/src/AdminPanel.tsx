import { useState, useEffect } from 'react';
import { Users, ShieldAlert } from 'lucide-react';

import { apiFetch } from './firebase';
import './AdminPanel.css';

export default function AdminPanel() {
  const [users, setUsers] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    apiFetch(`${API}/api/admin/stats`)
      .then(r => r.json())
      .then(d => { if (d.success) setUsers(d.stats.users); })
      .catch(err => console.error("Erro ao buscar dados do admin:", err))
      .finally(() => setLoading(false));
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
            <div className="lx-stat-value">{loading ? '...' : users}</div>
            <div className="lx-stat-label">Usuários Autorizados</div>
          </div>
        </div>

      </div>
    </div>
  );
}
