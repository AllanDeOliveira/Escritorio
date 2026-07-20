import React, { useState, useEffect } from 'react';
import { TrendingUp, Users, FileText, Calendar, Award, ChevronRight, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  currentUser: any;
  dbUser: any;
  isAdmin: boolean;
}

export default function ProductivityPanel({ currentUser, dbUser, isAdmin }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const endpoint = isAdmin ? `${API}/api/admin/stats` : `${API}/api/user/stats/${dbUser?.id}`;
        const headers = isAdmin ? { 'x-user-email': currentUser?.email || '' } : undefined;

        const res = await fetch(endpoint, { headers });
        const json = await res.json();
        
        if (json.success) {
          setData(json);
        } else {
          setError(json.error || 'Erro ao carregar dados');
        }
      } catch (err) {
        setError('Erro de conexão');
      } finally {
        setLoading(false);
      }
    };

    if (dbUser?.id || isAdmin) {
      fetchData();
    }
  }, [dbUser, isAdmin]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '400px', gap: '1rem', color: 'var(--text-secondary)' }}>
        <Loader2 className="lx-spin" size={32} color="var(--gold)" />
        <p>Carregando seu relatório de produtividade...</p>
      </div>
    );
  }

  if (error) {
    return <div className="lx-alert lx-alert-error">{error}</div>;
  }

  // View de Administrador (Relatório Geral)
  if (isAdmin) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="lx-single-panel" style={{ padding: '2rem' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.8rem', color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
              <Users size={28} color="var(--gold)" /> Relatório Geral de Produtividade
            </h2>
            <p style={{ color: 'var(--text-secondary)' }}>Visão consolidada de desempenho de todos os advogados do escritório.</p>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '16px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-shell)', textAlign: 'left' }}>
                  <th style={{ padding: '1.2rem 1rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Advogado</th>
                  <th style={{ padding: '1.2rem 1rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>E-mail</th>
                  <th style={{ padding: '1.2rem 1rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Peças Geradas</th>
                  <th style={{ padding: '1.2rem 1rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {data.userReports?.map((user: any) => (
                  <tr key={user.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '1.2rem 1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{user.name || 'Sem nome'}</td>
                    <td style={{ padding: '1.2rem 1rem', color: 'var(--text-secondary)' }}>{user.email}</td>
                    <td style={{ padding: '1.2rem 1rem', textAlign: 'center' }}>
                      <span style={{ background: 'rgba(208, 170, 100, 0.1)', color: 'var(--gold)', padding: '0.3rem 0.8rem', borderRadius: '20px', fontWeight: 800, fontSize: '0.85rem' }}>
                        {user.docCount}
                      </span>
                    </td>
                    <td style={{ padding: '1.2rem 1rem', textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {new Date(user.createdAt).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>
    );
  }

  // View de Advogado (Relatório Individual)
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="lx-single-panel" style={{ padding: '2rem' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        
        {/* Header Perfil */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', marginBottom: '3rem', padding: '2rem', background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(208, 170, 100, 0.05) 100%)', borderRadius: '24px', border: '1px solid var(--border)' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--primary)', border: '2px solid var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', fontWeight: 800, fontSize: '2rem' }}>
            {data.stats.name?.charAt(0).toUpperCase() || '?'}
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '2rem', color: 'var(--text-primary)', margin: 0 }}>{data.stats.name || 'Advogado LexGen'}</h2>
            <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Calendar size={14} /> Membro desde {new Date(data.stats.memberSince).toLocaleDateString('pt-BR')}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Award size={14} color="var(--gold)" /> Plano Professional</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--gold)', lineHeight: 1 }}>{data.stats.totalDocs}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '0.2rem' }}>Peças Geradas</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '2rem' }}>
          
          {/* Recent Activity */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <FileText size={18} color="var(--gold)" /> Atividades Recentes
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {data.recentDocs?.length > 0 ? data.recentDocs.map((doc: any) => (
                <div key={doc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: 'var(--bg-shell)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{doc.title}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cliente: {doc.clientName} • {new Date(doc.createdAt).toLocaleDateString('pt-BR')}</div>
                  </div>
                  <ChevronRight size={18} color="var(--text-muted)" />
                </div>
              )) : (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Nenhuma peça gerada ainda. Comece agora para ver seu progresso!
                </div>
              )}
            </div>
          </div>

          {/* Productivity Goals */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>Sua Meta Mensal</h3>
              <div style={{ height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden', marginBottom: '0.8rem' }}>
                <div style={{ width: `${Math.min(100, (data.stats.totalDocs / 20) * 100)}%`, height: '100%', background: 'var(--gold)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <span>{data.stats.totalDocs} de 20 peças</span>
                <span>{Math.round((data.stats.totalDocs / 20) * 100)}%</span>
              </div>
            </div>

            <div style={{ background: 'linear-gradient(45deg, var(--primary), #1a1a1a)', borderRadius: '20px', padding: '1.5rem', color: '#fff' }}>
              <TrendingUp size={24} color="var(--gold)" style={{ marginBottom: '1rem' }} />
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>Eficiência IA</h3>
              <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', margin: 0 }}>Você economizou aproximadamente <b>{data.stats.totalDocs * 2} horas</b> de redação este mês usando o LexGen.</p>
            </div>
          </div>

        </div>

      </div>
    </motion.div>
  );
}
