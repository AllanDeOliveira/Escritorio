import React, { useState, useEffect } from 'react';
import { Wifi, QrCode, Settings, CheckCircle2, AlertCircle, Loader2, Save } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function WhatsAppCenter({ currentUser }: { currentUser: any }) {
  const authHeaders = { 'x-user-email': currentUser?.email || '' };
  const [serverStatus, setServerStatus] = useState('LOADING'); // LOADING, DISCONNECTED, WAITING_QR, CONNECTED
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [groups, setGroups] = useState<Array<{ id: string, name: string }>>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isMonthlyLoading, setIsMonthlyLoading] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API}/api/whatsapp/status`, { headers: authHeaders });
      const data = await res.json();
      setServerStatus(data.status);
      setQrCodeData(data.qrCodeUrl);
      if (data.status === 'CONNECTED') {
        fetchGroupsAndSettings();
      }
    } catch (err) {
      console.error(err);
      setServerStatus('ERROR');
    }
  };

  const fetchGroupsAndSettings = async () => {
    try {
      const [groupsRes, settingsRes] = await Promise.all([
        fetch(`${API}/api/whatsapp/groups`, { headers: authHeaders }).then(r => r.json()),
        fetch(`${API}/api/whatsapp/settings`, { headers: authHeaders }).then(r => r.json())
      ]);
      setGroups(groupsRes || []);
      if (settingsRes && settingsRes.whatsappGroupId) {
        setSelectedGroupId(settingsRes.whatsappGroupId);
      }
    } catch (err) {
      console.error('Erro ao buscar grupos e configs', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      if (serverStatus !== 'CONNECTED') fetchStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [serverStatus]);

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMsg('');
    try {
      const group = groups.find(g => g.id === selectedGroupId);
      await fetch(`${API}/api/whatsapp/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          whatsappGroupId: selectedGroupId,
          whatsappGroupName: group ? group.name : ''
        })
      });
      setMsg('success:Configuração salva! O robô enviará as notificações neste grupo.');
    } catch (err) {
      setMsg('error:Erro ao salvar configuração.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestMessage = async () => {
    setIsTesting(true);
    setMsg('');
    try {
      const res = await fetch(`${API}/api/whatsapp/test-message`, {
        method: 'POST',
        headers: authHeaders
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('success:Mensagem de teste enviada com sucesso para o grupo!');
    } catch (err: any) {
      setMsg(`error:Erro no teste: ${err.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSendHearings = async () => {
    setIsSending(true);
    setMsg('');
    try {
      const res = await fetch(`${API}/api/whatsapp/send-hearings`, {
        method: 'POST',
        headers: authHeaders
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('success:Audiências do dia enviadas com sucesso no grupo!');
    } catch (err: any) {
      setMsg(`error:Erro ao disparar: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleSendMonthly = async () => {
    setIsMonthlyLoading(true);
    setMsg('');
    try {
      const res = await fetch(`${API}/api/whatsapp/send-monthly`, {
        method: 'POST',
        headers: authHeaders
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('success:Relatório mensal disparado com sucesso no grupo!');
    } catch (err: any) {
      setMsg(`error:Erro no relatório mensal: ${err.message}`);
    } finally {
      setIsMonthlyLoading(false);
    }
  };

  const handleDisconnect = async () => {
    (window as any).showConfirm('Tem certeza de que deseja desconectar o WhatsApp do painel? Você precisará ler o QR Code novamente para conectar.', async () => {
      setIsDisconnecting(true);
      try {
        await fetch(`${API}/api/whatsapp/disconnect`, { method: 'POST', headers: authHeaders });
        setMsg('');
        setServerStatus('DISCONNECTED'); // Let the 5s interval re-catch 'WAITING_QR' after reboot
        (window as any).showToast('Sessão encerrada com sucesso.', 'success');
      } catch (err) {
        (window as any).showToast('Erro ao tentar desconectar.', 'error');
      } finally {
        setIsDisconnecting(false);
      }
    });
  };

  return (
    <div className="lx-grid-3">

      {/* ── Painel Esquerdo (Status e QR Code) ───────────────────────── */}
      <div className="lx-card lx-col-left" style={{ gridColumn: '1 / 2', display: 'flex', flexDirection: 'column', textAlign: 'center' }}>
        <div className="lx-card-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: serverStatus === 'CONNECTED' ? 'var(--success)' : (serverStatus === 'DISCONNECTED' || serverStatus === 'ERROR' ? 'var(--error)' : 'var(--secondary)') }}>
            <Wifi size={20} />
            {serverStatus === 'LOADING' && 'Verificando Servidor...'}
            {serverStatus === 'DISCONNECTED' && 'Servidor Desconectado'}
            {serverStatus === 'WAITING_QR' && 'Aguardando Leitura'}
            {serverStatus === 'CONNECTED' && 'Bot Conectado'}
            {serverStatus === 'ERROR' && 'Erro de Conexão'}
          </h3>
        </div>

        <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
          {serverStatus === 'LOADING' && (
            <Loader2 className="lx-spin" size={48} color="var(--primary)" style={{ margin: 'auto' }} />
          )}

          {(serverStatus === 'DISCONNECTED' || serverStatus === 'ERROR') && (
            <div className="lx-empty">
              <AlertCircle size={48} color="var(--error)" style={{ marginBottom: '1rem' }} />
              <p style={{ color: 'var(--text-secondary)' }}>O serviço local do WhatsApp não pôde ser contatado.<br />Verifique se o backend está rodando no terminal.</p>
            </div>
          )}

          {serverStatus === 'WAITING_QR' && (
            <>
              {qrCodeData ? (
                <div style={{ background: '#fff', padding: '1rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', display: 'inline-block' }}>
                  <img src={qrCodeData} alt="QR Code WhatsApp" style={{ width: '220px', height: '220px', display: 'block' }} />
                </div>
              ) : (
                <div style={{ width: '220px', height: '220px', border: '1px dashed var(--border)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Loader2 className="lx-spin" size={32} color="var(--primary)" />
                </div>
              )}
              <h4 style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                <QrCode size={18} /> Escaneie para Conectar
              </h4>
              <p className="lx-insights-text" style={{ marginTop: '0.75rem' }}>
                Abra o WhatsApp no celular, vá em "Aparelhos Conectados" e aponte a câmera.
              </p>
            </>
          )}

          {serverStatus === 'CONNECTED' && (
            <div className="lx-empty" style={{ border: 'none' }}>
              <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem', margin: '0 auto' }}>
                <CheckCircle2 size={40} color="var(--success)" />
              </div>
              <p className="lx-insights-text" style={{ marginBottom: '1.5rem' }}>
                O robô está rodando em segundo plano e avisará automaticamente o grupo selecionado sempre que encontrar audiências.
              </p>

              <button
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="lx-btn-tool"
                style={{ color: 'var(--error)', borderColor: 'rgba(239, 68, 68, 0.3)', margin: '0 auto' }}
              >
                {isDisconnecting ? <Loader2 className="lx-spin" size={16} /> : 'Desconectar Dispositivo'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Painel Direito (Configurações) ───────────────────────────── */}
      <div className="lx-card lx-col-span-3" style={{ gridColumn: '2 / -1', opacity: serverStatus === 'CONNECTED' ? 1 : 0.5, pointerEvents: serverStatus === 'CONNECTED' ? 'auto' : 'none', display: 'flex', flexDirection: 'column' }}>
        <div className="lx-card-header">
          <h3><Settings size={18} style={{ marginRight: '6px', verticalAlign: 'middle' }} /> Operações em Tempo Real</h3>
        </div>

        <p className="lx-insights-text" style={{ marginBottom: '1.5rem' }}>
          Envie os resumos de audiência lendo diretamente do seu Excel <strong>AUDIÊNCIAS 2026.xlsx</strong>.
        </p>

        {msg && (
          <div className={`lx-alert ${msg.startsWith('success:') ? 'lx-alert-success' : 'lx-alert-error'}`}>
            {msg.replace(/^(success:|error:)/, '')}
          </div>
        )}

        <form onSubmit={saveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flex: 1 }}>
          <div className="lx-input-group">
            <label className="lx-input-label" style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', display: 'block' }}>Grupo Alvo (Recebedor das Notificações)</label>
            {groups.length > 0 ? (
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                required
                className="lx-input"
                style={{ width: '100%', padding: '0.8rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--bg-input)', outline: 'none', color: 'var(--text-primary)' }}
              >
                <option value="" disabled>-- Selecione um grupo nos seus contatos --</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            ) : (
              <div className="lx-input" style={{ width: '100%', padding: '0.8rem', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--bg-input)', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                <Loader2 className="lx-spin" size={16} /> Carregando grupos do WhatsApp...
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: 'auto', flexWrap: 'wrap' }}>
            <button
              type="submit"
              className="lx-btn-tool lx-btn-tool-highlight"
              disabled={isSaving || !selectedGroupId}
              style={{ padding: '0.75rem 1.2rem', flex: 1, minWidth: '160px', display: 'flex', justifyContent: 'center' }}
            >
              {isSaving ? <Loader2 className="lx-spin" size={18} /> : <Save size={18} />}
              {isSaving ? 'Salvando...' : 'Salvar Grupo'}
            </button>

            <button
              type="button"
              onClick={handleSendHearings}
              className="lx-btn-generate"
              disabled={isSending || isMonthlyLoading || !selectedGroupId}
              style={{ flex: 1, minWidth: '160px', display: 'flex', justifyContent: 'center' }}
            >
              {isSending ? <Loader2 className="lx-spin" size={18} /> : 'Enviar Notificações Hoje'}
            </button>

            <button
              type="button"
              onClick={handleSendMonthly}
              className="lx-btn-generate"
              disabled={isMonthlyLoading || isSending || !selectedGroupId}
              style={{ flex: 1, minWidth: '160px', backgroundColor: 'var(--secondary)', color: 'var(--primary)', display: 'flex', justifyContent: 'center' }}
            >
              {isMonthlyLoading ? <Loader2 className="lx-spin" size={18} /> : 'Disparar Resumo Mensal'}
            </button>

            <button
              type="button"
              onClick={handleTestMessage}
              className="lx-btn-tool"
              disabled={isTesting || !selectedGroupId}
              style={{ flex: 1, minWidth: '160px', display: 'flex', justifyContent: 'center' }}
            >
              {isTesting ? <Loader2 className="lx-spin" size={18} /> : 'Mensagem de Teste'}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
