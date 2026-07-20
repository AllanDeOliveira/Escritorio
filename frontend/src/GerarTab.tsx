import { type RefObject, type Dispatch, type SetStateAction } from 'react';
import {
  UploadCloud, X, Copy, Download, Edit3, CheckCircle, FileText, BookOpen, Plus,
  AlertCircle, PieChart, Target, Eye, Zap, Sword, Loader2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { motion } from 'framer-motion';
import SkeletonPetition from './SkeletonPetition';
import type { ModeloInfo } from './ModelosTab';
import './GerarTab.css';

interface GerarTabProps {
  step: 'upload' | 'review' | 'result';
  setStep: (s: 'upload' | 'review' | 'result') => void;
  errorMsg: string;
  isDragging: boolean;
  setIsDragging: (b: boolean) => void;
  files: File[];
  setFiles: Dispatch<SetStateAction<File[]>>;
  fileInputRef: RefObject<HTMLInputElement>;
  modeloEspecificoInputRef: RefObject<HTMLInputElement>;
  modeloEspecificoFiles: File[];
  setModeloEspecificoFiles: Dispatch<SetStateAction<File[]>>;
  modelos: ModeloInfo[];
  loading: boolean;
  handleSubmit: (e: React.FormEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  verifyFile: (f: File) => boolean;
  result: string;
  setResult: (v: string) => void;
  pdfUrl: string | null;
  showPdf: boolean;
  setShowPdf: (b: boolean) => void;
  isEditing: boolean;
  setIsEditing: (b: boolean) => void;
  copied: boolean;
  handleCopy: () => void;
  downloadingFormat: 'docx' | 'pdf' | null;
  handleDownload: (format: 'docx' | 'pdf') => void;
  activePhrases: string[];
  loadingPhraseIdx: number;
  analytics: { prob?: string, est?: string };
  mapaContradicoes: any[];
}

export default function GerarTab({
  step,
  setStep,
  errorMsg,
  isDragging,
  setIsDragging,
  files,
  setFiles,
  fileInputRef,
  modeloEspecificoInputRef,
  modeloEspecificoFiles,
  setModeloEspecificoFiles,
  modelos,
  loading,
  handleSubmit,
  handleDrop,
  handleFileSelect,
  verifyFile,
  result,
  setResult,
  pdfUrl,
  showPdf,
  setShowPdf,
  isEditing,
  setIsEditing,
  copied,
  handleCopy,
  downloadingFormat,
  handleDownload,
  activePhrases,
  loadingPhraseIdx,
  analytics,
  mapaContradicoes,
}: GerarTabProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="lx-grid-3">
      <div className="lx-col-left gerar-col-left" style={{ display: step === 'result' ? 'none' : 'block' }}>
        <div className="lx-card gerar-left-card">
          <div className="lx-card-header">
            <h3>{step === 'upload' ? 'Documentos da Peça' : 'Revisão de Fatos Extraídos'}</h3>
          </div>
          {errorMsg && <div className="lx-alert lx-alert-error"><AlertCircle size={15} />{errorMsg}</div>}

          {step === 'upload' ? (
            <form onSubmit={handleSubmit} className="gerar-upload-form">

              <div className={`lx-dropzone ${isDragging ? 'active' : ''}`}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}>
                <div className="lx-dropzone-icon">
                  <UploadCloud size={24} />
                </div>
                <div className="lx-dropzone-title">Anexar Documentos</div>
                <div className="lx-dropzone-sub">PDF, DOCX ou Imagens<br />Arraste para cá</div>
                <input type="file" multiple ref={fileInputRef} className="gerar-hidden-input" onChange={handleFileSelect} accept=".pdf,.docx,.txt,.jpg,.jpeg,.png" title="Upload de arquivos de petição" />
              </div>

              {files.length > 0 && (
                <div className="lx-uploaded-section gerar-upload-section-mb">
                  <div className="lx-uploaded-label">Arquivos selecionados ({files.length})</div>
                  <div className="lx-uploaded-grid">
                    {files.map((f, i) => (
                      <div key={i} className="lx-uploaded-file">
                        <div className="lx-file-thumb">
                          <span className="lx-file-ext">{f.name.split('.').pop()}</span>
                        </div>
                        <span className="lx-file-thumb-name" title={f.name}>{f.name}</span>
                        <button type="button" className="lx-file-thumb-del" title="Remover arquivo" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="lx-uploaded-section" style={{ marginBottom: '1rem', marginTop: files.length > 0 ? '0' : '1rem' }}>
                <div className="lx-uploaded-label gerar-label-row">
                  <BookOpen size={14} color="var(--primary)" />
                  <span>Modelo Específico para esta Peça (Opcional)</span>
                </div>
                <p className="gerar-hint-text">Anexe um arquivo para a IA usar como base principal de estilo e estrutura.</p>

                <button type="button" className="lx-btn-tool gerar-attach-btn" onClick={() => modeloEspecificoInputRef.current?.click()}>
                  <Plus size={16} /> Anexar Modelo Específico
                </button>
                <input type="file" ref={modeloEspecificoInputRef} className="gerar-hidden-input" title="Selecionar modelo específico" onChange={e => {
                  if (e.target.files) setModeloEspecificoFiles(p => [...p, ...Array.from(e.target.files!).filter(verifyFile)]);
                }} accept=".pdf,.docx,.txt" multiple />

                {modeloEspecificoFiles.length > 0 && (
                  <div className="lx-uploaded-grid gerar-mt-sm">
                    {modeloEspecificoFiles.map((f, i) => (
                      <div key={i} className="lx-uploaded-file gerar-file-highlight">
                        <div className="lx-file-thumb gerar-file-thumb-highlight">
                          <span className="lx-file-ext">{f.name.split('.').pop()}</span>
                        </div>
                        <span className="lx-file-thumb-name" title={f.name}>{f.name}</span>
                        <button type="button" className="lx-file-thumb-del" title="Remover modelo específico" onClick={() => setModeloEspecificoFiles(modeloEspecificoFiles.filter((_, j) => j !== i))}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {modelos.length > 0 && (
                <div className="lx-modelos-badge gerar-mb-1">
                  <CheckCircle size={14} />
                  <span>{modelos.length} modelo(s) ativo(s)</span>
                </div>
              )}

              <button type="submit" id="btn-gerar" className="lx-btn-generate gerar-submit-btn" disabled={loading}>
                {loading ? <Loader2 className="lx-spin" size={18} /> : <Zap size={18} />}
                {loading ? 'Redigindo Petição...' : 'Gerar Petição Instantânea'}
              </button>
            </form>
          ) : (
            <div className="gerar-success-wrap">
              <div className="gerar-success-icon">
                <CheckCircle size={32} />
              </div>
              <h4 className="gerar-mb-sm">Peça Gerada com Sucesso</h4>
              <p className="gerar-success-desc">A redação final foi concluída com base nos dados verificados.</p>
              <button className="lx-btn-secondary" onClick={() => { setStep('upload'); setResult(''); }}>
                <Plus size={18} /><span>Novo Caso</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="lx-card lx-col-span-3 gerar-right-card" style={{ gridColumn: step === 'result' ? '1 / -1' : '2 / -1' }}>
        <div className="lx-card-header">
          <h3>Peça Gerada</h3>
          {result && (
            <div className="lx-result-toolbar">
              <button className="lx-btn-tool gerar-new-case-btn" onClick={() => { setStep('upload'); setResult(''); }}>
                <Plus size={14} /> Novo Caso
              </button>
              {pdfUrl && (
                <button className={`lx-btn-tool ${showPdf ? 'active' : ''}`} onClick={() => setShowPdf(!showPdf)} style={{ background: showPdf ? 'rgba(212, 175, 55, 0.15)' : '', color: showPdf ? '#D4AF37' : '' }}>
                  <Eye size={14} /> {showPdf ? 'Ocultar PDF' : 'Ver PDF Original'}
                </button>
              )}
              <button className="lx-btn-tool" onClick={() => setIsEditing(!isEditing)}>
                {isEditing ? <CheckCircle size={14} /> : <Edit3 size={14} />} {isEditing ? 'Salvar' : 'Editar'}
              </button>
              <button className="lx-btn-tool" onClick={handleCopy}>
                <Copy size={14} /> {copied ? 'Copiado!' : 'Copiar'}
              </button>
              <button className="lx-btn-tool lx-btn-tool-highlight" onClick={() => handleDownload('docx')} disabled={!!downloadingFormat}>
                {downloadingFormat === 'docx' ? <Loader2 className="lx-spin" size={14} /> : <Download size={14} />}
                DOCX
              </button>
              <button className="lx-btn-tool lx-btn-tool-highlight gerar-pdf-download-btn" onClick={() => handleDownload('pdf')} disabled={!!downloadingFormat}>
                {downloadingFormat === 'pdf' ? <Loader2 className="lx-spin" size={14} /> : <FileText size={14} />}
                PDF
              </button>
            </div>
          )}
        </div>
        <div className="lx-result-container gerar-result-container">

          {/* 1. Visualizador de PDF (Lateral - Ocupação Total) */}
          {showPdf && pdfUrl && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="gerar-pdf-viewer"
              style={{ flex: result ? 2 : 1.5 }}>
              <div className="gerar-pdf-viewer-header">
                <div className="gerar-pdf-viewer-title-group">
                  <BookOpen size={16} color="var(--gold)" />
                  <span className="gerar-pdf-viewer-title">Visualização do Documento</span>
                </div>
                <button
                  onClick={() => setShowPdf(false)}
                  className="lx-btn-tool gerar-pdf-close-btn"
                  title="Fechar visualização"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="gerar-pdf-frame-wrap">
                <iframe
                  src={pdfUrl}
                  className="gerar-pdf-iframe"
                  title="PDF Preview"
                />
              </div>
            </motion.div>
          )}

          {/* 2. Conteúdo Central (Placeholder, Carregamento ou Resultado) */}
          <div className="gerar-center-content" style={{ flex: result ? (showPdf ? 1.5 : 2) : 1 }}>
            {loading ? (
              <SkeletonPetition phrase={activePhrases[loadingPhraseIdx] || 'Processando...'} />
            ) : !result ? (
              <div className="gerar-waiting-state">
                <FileText size={48} opacity={0.2} className="gerar-mb-1" />
                <h4 className="gerar-waiting-title">Aguardando Geração</h4>
                <p className="gerar-text-sm">Anexe os documentos e clique em "Gerar Peça".</p>
              </div>
            ) : (
              <div className="lx-result-body gerar-result-body-inner">

                {/* Relatórios e Analytics */}
                {(analytics.prob || analytics.est) && (
                  <div className="gerar-analytics-box">
                    <div className="gerar-analytics-header">
                      <PieChart size={18} /> Analytics de IA
                    </div>
                    <div className="gerar-text-sm">{analytics.prob && <div>Probabilidade: {analytics.prob}</div>}{analytics.est && <div>Estratégia: {analytics.est}</div>}</div>
                  </div>
                )}

                {/* Editor ou Visualizador */}
                {isEditing ? (
                  <div className="lx-quill-container">
                    <ReactQuill theme="snow" value={result} onChange={setResult} />
                  </div>
                ) : (
                  <div className="lx-markdown-preview"><ReactMarkdown>{result}</ReactMarkdown></div>
                )}
              </div>
            )}
          </div>

          {/* 3. Mapa de Contradições (Battle Log) */}
          {result && mapaContradicoes && mapaContradicoes.length > 0 && (
            <div className="lx-timeline-panel gerar-timeline-panel-size">
              <div className="lx-timeline-header gerar-timeline-header-border">
                <div className="lx-timeline-header-icon gerar-timeline-icon-tint"><Target size={15} /></div>
                <div>
                  <div className="lx-timeline-header-title">Dossiê Estratégico</div>
                  <div className="lx-timeline-header-sub">{mapaContradicoes.length} contra-argumentos detectados</div>
                </div>
              </div>

              <div className="lx-timeline-track gerar-timeline-track-pad">
                {mapaContradicoes.map((c: any, i: number) => {
                  const highlightIDs = (txt: string) => {
                    if (!txt) return txt;
                    const parts = txt.split(/(ID\s*\d+)/gi);
                    return parts.map((part, idx) =>
                      part.match(/ID\s*\d+/i) ? <b key={idx} className="gerar-highlight-id">{part}</b> : part
                    );
                  };

                  return (
                    <div key={i} className="lx-conflict-card">
                      <div className="lx-conflict-point">
                        <span className={`lx-conflict-tag lx-conflict-tag-${(c.gravidade || 'MÉDIO').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "")}`}>
                          {c.gravidade || 'MÉDIO'}
                        </span>
                        {highlightIDs(c.ponto)}
                      </div>

                      <div className="lx-conflict-duo">
                        <div className="lx-conflict-side lx-conflict-side-adv">
                          <div className="lx-conflict-label">Versão Adversa</div>
                          <p>{highlightIDs(c.versaoAdversa)}</p>
                        </div>
                        <div className="lx-conflict-side lx-conflict-side-def">
                          <div className="lx-conflict-label">Nossa Prova</div>
                          <p>{highlightIDs(c.versaoDefesa)}</p>
                        </div>
                      </div>

                      <div className="lx-conflict-weapon">
                        <div className="gerar-weapon-row">
                          <Sword size={14} />
                          <strong>ARMA ESTRATÉGICA</strong>
                        </div>
                        <span className="gerar-text-sm">{highlightIDs(c.prova)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
