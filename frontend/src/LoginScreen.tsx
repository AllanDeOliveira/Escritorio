import { useState } from 'react';
import { Loader2, AlertCircle, ShieldAlert } from 'lucide-react';
import { apiFetch, API, type Usuario } from './api';

export default function LoginScreen({ onLogin, systemName }: { onLogin: (u: Usuario) => void, systemName: string }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      });
      const d = await r.json();
      if (d.success) onLogin(d.user);
      else setError(d.error || 'Não foi possível entrar.');
    } catch {
      setError('Sem conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lx-login-screen">
      <div className="lx-login-bg-glow" />
      <form className="lx-login-card" onSubmit={entrar}>
        <div className="lx-login-logo-wrap">
          <img src="logo.png" alt="Logo JVO" />
        </div>
        <h1 className="lx-login-title">{systemName}</h1>
        <p className="lx-login-subtitle">Plataforma de Inteligência Jurídica<br />Acesso restrito à equipe autorizada</p>

        <div className="lx-login-aviso">
          <ShieldAlert size={16} />
          <span>Entre com o e-mail e a senha que o administrador cadastrou para você.</span>
        </div>

        <input
          className="lx-login-input" type="email" autoComplete="username" placeholder="E-mail" aria-label="E-mail"
          value={email} onChange={e => setEmail(e.target.value)} required autoFocus
        />
        <input
          className="lx-login-input" type="password" autoComplete="current-password" placeholder="Senha" aria-label="Senha"
          value={senha} onChange={e => setSenha(e.target.value)} required
        />

        <button id="btn-login" type="submit" className="lx-btn-google" disabled={loading}>
          {loading && <Loader2 size={20} className="lx-spin" />}
          {loading ? 'Entrando...' : 'Entrar'}
        </button>

        {error && (
          <div className="lx-login-error">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <p className="lx-login-footer-text">
          Esqueceu a senha? Peça ao administrador para redefinir.
        </p>
      </form>
    </div>
  );
}
