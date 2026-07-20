import { type RefObject } from 'react';
import { Plus, Loader2, BookOpen, Zap, Eye, Trash2, UploadCloud } from 'lucide-react';

export interface ModeloInfo {
  nome: string;
  tamanho: number;
  criadoEm: string;
  adicionadoPor?: string;
  nomeLimpo?: string;
}

interface ModelosTabProps {
  modelos: ModeloInfo[];
  loadingModelos: boolean;
  modeloInputRef: RefObject<HTMLInputElement>;
  onUpload: (files: FileList) => void;
  onDelete: (nome: string) => void;
  onPreview: (nome: string) => void;
  onUseModel: () => void;
}

export default function ModelosTab({
  modelos,
  loadingModelos,
  modeloInputRef,
  onUpload,
  onDelete,
  onPreview,
  onUseModel,
}: ModelosTabProps) {
  return (
    <div className="lx-single-panel" style={{ background: 'transparent', padding: 0 }}>
      <div className="lx-models-header" style={{ marginBottom: '2rem' }}>
        <div>
          <h1 className="lx-models-title">Base de Conhecimento (Machine Learning)</h1>
          <p className="lx-models-subtitle">Treine a IA subindo suas petições vitoriosas do passado para que ela aprenda seu estilo e suas teses.</p>
        </div>
        <button className="lx-btn-primary" onClick={() => modeloInputRef.current?.click()} style={{ padding: '0.75rem 1.5rem', whiteSpace: 'nowrap', background: '#10b981', borderColor: '#10b981' }}>
          <Plus size={18} /> Adicionar Petição de Referência
        </button>
        <input type="file" ref={modeloInputRef} style={{ display: 'none' }} multiple onChange={(e) => e.target.files && onUpload(e.target.files)} />
      </div>


      <div className="lx-models-grid">
        {loadingModelos ? (
          <div className="lx-models-loading"><Loader2 className="lx-spin" /> Carregando biblioteca...</div>
        ) : modelos.length > 0 ? (
          modelos.map((m: any, i: number) => {
            const isBancario = /banc[aá]ri|banco|caixa|bradesco|itau/i.test(m.nome);
            const isCivel = /c[ií]vel|danos?|indeniza/i.test(m.nome);
            const isImpugnacao = /impugna/i.test(m.nome);

            return (
              <div key={i} className="lx-model-card">
                <div className="lx-model-card-icon">
                  <BookOpen size={24} />
                </div>
                <div className="lx-model-card-content">
                  <div className="lx-model-tags">
                    {isBancario && <span className="lx-tag lx-tag-blue">Bancário</span>}
                    {isCivel && <span className="lx-tag lx-tag-purple">Cível</span>}
                    {isImpugnacao && <span className="lx-tag lx-tag-gold">Impugnação</span>}
                  </div>
                  <h3 className="lx-model-name" title={m.nomeLimpo || m.nome}>{m.nomeLimpo || m.nome}</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', margin: '0.4rem 0' }}>
                    <span style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', color: 'var(--text-muted)' }}>
                      {(m.tamanho / 1024).toFixed(0)} KB
                    </span>
                    <span style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '4px', color: 'var(--success)' }}>
                       {new Date(m.criadoEm).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="lx-model-desc" style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                    Adicionado por: <strong style={{ color: 'var(--gold)' }}>{m.adicionadoPor || 'Sistema'}</strong>
                  </p>

                  <div className="lx-model-actions">
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="lx-model-btn-use" onClick={onUseModel}>
                        <Zap size={14} /> Usar
                      </button>
                      <button className="lx-model-btn-view" onClick={() => onPreview(m.nome)} title="Visualizar Modelo">
                        <Eye size={14} />
                      </button>
                    </div>
                    <button className="lx-model-btn-del" onClick={() => onDelete(m.nome)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="lx-models-empty">
            <UploadCloud size={48} opacity={0.2} />
            <p>Sua Base de Conhecimento está vazia. Envie petições passadas de sucesso para treinar a IA.</p>
          </div>
        )}
      </div>
    </div>
  );
}
