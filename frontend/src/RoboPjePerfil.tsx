import { useEffect, useState } from 'react';
import { apiFetch, API } from './api';

type TokenRobo = { id: string; criadoEm: string; ultimoUsoEm: string | null; revogadoEm: string | null };

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'nunca';

/**
 * Aba Perfil › Robô do PJe: o robô roda no PC de quem tem o certificado e se identifica com
 * este token (não com a senha do Central). O token aparece uma vez só, na hora de gerar.
 */
export default function RoboPjePerfil({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const [tokens, setTokens] = useState<TokenRobo[]>([]);
  const [novo, setNovo] = useState<string | null>(null);

  const carregar = () => apiFetch(`${API}/api/users/me/tokens-robo`)
    .then(r => r.json()).then(d => { if (d.success) setTokens(d.tokens); })
    .catch(() => { /* lista vazia */ });
  useEffect(() => { carregar(); }, []);

  const gerar = async () => {
    try {
      const d = await (await apiFetch(`${API}/api/users/me/tokens-robo`, { method: 'POST' })).json();
      if (!d.success) return showToast(d.error || 'Erro ao gerar o token.', 'error');
      setNovo(d.token);
      carregar();
    } catch { showToast('Erro ao gerar o token.', 'error'); }
  };

  const revogar = async (id: string) => {
    try {
      const r = await apiFetch(`${API}/api/users/me/tokens-robo/${id}`, { method: 'DELETE' });
      if (!r.ok) return showToast('Erro ao revogar o token.', 'error');
      showToast('Token revogado: o robô que usava ele para de funcionar.', 'info');
      carregar();
    } catch { showToast('Erro ao revogar o token.', 'error'); }
  };

  const ativos = tokens.filter(t => !t.revogadoEm);
  return (
    <div className="app-perfil-section">
      <div className="app-perfil-section-title">Robô do PJe</div>
      <p className="app-perfil-sublabel">
        Os prazos do PJe são lidos por um robô no PC que tem o certificado. Lá, rode
        <code> npm run robo-pje -- configurar </code> na pasta <code>robo-pje</code> e cole o token gerado aqui.
        O token só serve para o robô enviar a leitura — não abre o sistema.
      </p>
      {novo && (
        <div className="app-robo-token">
          <strong>Copie agora — ele não aparece de novo:</strong>
          <code>{novo}</code>
          <button type="button" className="lx-btn-tool" onClick={() => { navigator.clipboard?.writeText(novo); showToast('Token copiado.', 'success'); }}>Copiar</button>
          <button type="button" className="lx-btn-tool" onClick={() => setNovo(null)}>Pronto</button>
        </div>
      )}
      {ativos.map(t => (
        <div key={t.id} className="app-robo-linha">
          <span>Gerado em {quando(t.criadoEm)} · último uso: {quando(t.ultimoUsoEm)}</span>
          <button type="button" className="lx-btn-tool" onClick={() => revogar(t.id)}>Revogar</button>
        </div>
      ))}
      <button type="button" className="lx-btn-tool app-save-config-btn" onClick={gerar}>Gerar token do robô do PJe</button>
    </div>
  );
}
