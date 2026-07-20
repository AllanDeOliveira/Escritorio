import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { motion } from 'framer-motion';

export default function NameCaptureModal({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="lx-modal-overlay" style={{ zIndex: 99999, backdropFilter: 'blur(10px)', background: 'rgba(0,0,0,0.6)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        style={{
          padding: '3rem 2.5rem',
          textAlign: 'center',
          width: '100%',
          maxWidth: '420px',
          background: 'var(--bg-card)',
          borderRadius: '24px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px var(--border)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
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

        <h2 style={{ marginBottom: '0.75rem', color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>Bem-vindo ao Central JVO</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '0.95rem', lineHeight: 1.5 }}>
          Para personalizar sua experiência, como gostaria de ser chamado na plataforma?
        </p>

        <div style={{ position: 'relative', marginBottom: '2rem' }}>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Dr. Silva, João..."
            style={{
              width: '100%',
              padding: '1rem 1.25rem',
              textAlign: 'center',
              fontSize: '1.1rem',
              fontWeight: 500,
              background: 'var(--bg-input)',
              border: '2px solid transparent',
              borderRadius: '12px',
              color: 'var(--text-primary)',
              outline: 'none',
              transition: 'all 0.2s ease',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
            }}
            onFocus={e => e.target.style.borderColor = 'var(--gold)'}
            onBlur={e => e.target.style.borderColor = 'transparent'}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSubmit(name.trim()) }}
          />
        </div>

        <button
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
            cursor: name.trim() ? 'pointer' : 'not-allowed',
            opacity: name.trim() ? 1 : 0.5,
            transition: 'all 0.2s ease',
            boxShadow: name.trim() ? '0 4px 14px rgba(208, 170, 100, 0.4)' : 'none'
          }}
          onMouseEnter={e => { if (name.trim()) e.currentTarget.style.transform = 'translateY(-2px)' }}
          onMouseLeave={e => { if (name.trim()) e.currentTarget.style.transform = 'translateY(0)' }}
          onClick={() => { if (name.trim()) onSubmit(name.trim()); }}
        >
          Salvar e Entrar
        </button>
      </motion.div>
    </div>
  );
}
