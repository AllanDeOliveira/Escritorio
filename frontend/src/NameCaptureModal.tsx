import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import Modal from './Modal';

/**
 * Nome de exibição. No primeiro acesso é obrigatório (sem onClose: Esc e clique fora não fecham);
 * aberto pelo lápis do menu, quem já tem nome pode desistir.
 */
export default function NameCaptureModal({ onSubmit, onClose }: { onSubmit: (name: string) => void; onClose?: () => void }) {
  const [name, setName] = useState('');
  const ok = Boolean(name.trim());
  return (
    <Modal
      onClose={onClose}
      labelledBy="modal-nome"
      style={{
        padding: '3rem 2.5rem',
        textAlign: 'center',
        width: '100%',
        maxWidth: '420px',
        background: 'var(--bg-card)',
        border: 0,
        borderRadius: '24px',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px var(--border)',
        overflow: 'hidden'
      }}
    >
      <form onSubmit={e => { e.preventDefault(); if (ok) onSubmit(name.trim()); }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, var(--gold), #fcd34d)' }} />

        <div style={{
          width: '72px', height: '72px',
          margin: '0 auto 1.5rem',
          background: 'var(--primary-dim)',
          borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--gold)'
        }}>
          <ShieldAlert size={36} />
        </div>

        <h2 id="modal-nome" style={{ marginBottom: '0.75rem', color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>Bem-vindo ao Central JVO</h2>
        <label htmlFor="input-nome-exibicao" style={{ display: 'block', color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.95rem', lineHeight: 1.5 }}>
          Para personalizar sua experiência, como gostaria de ser chamado na plataforma?
        </label>

        <input
          id="input-nome-exibicao"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Ex: Dr. Silva, João..."
          data-autofocus
          style={{
            width: '100%',
            marginBottom: '2rem',
            padding: '1rem 1.25rem',
            textAlign: 'center',
            fontSize: '1.1rem',
            fontWeight: 500,
            background: 'var(--bg-input)',
            border: '2px solid transparent',
            borderRadius: '12px',
            color: 'var(--text-primary)',
            transition: 'all 0.2s ease',
            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
          }}
        />

        <button
          type="submit"
          disabled={!ok}
          style={{
            width: '100%',
            padding: '1rem',
            justifyContent: 'center',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'var(--gold)',
            color: '#000',
            border: 'none',
            borderRadius: '12px',
            fontSize: '1rem',
            fontWeight: 700,
            cursor: ok ? 'pointer' : 'not-allowed',
            opacity: ok ? 1 : 0.5,
            transition: 'all 0.2s ease',
            boxShadow: ok ? '0 4px 14px rgba(208, 170, 100, 0.4)' : 'none'
          }}
        >
          Salvar nome
        </button>
      </form>
    </Modal>
  );
}
