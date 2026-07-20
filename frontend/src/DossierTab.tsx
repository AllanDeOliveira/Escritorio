import ReactMarkdown from 'react-markdown';
import {
  Loader2, History as HistoryIcon, BookOpen, Clock, Calendar, Eye, Trash2, X, Zap,
  Star, Save, Edit3, Download, FileText, Target, Sword, CheckCircle, Copy,
} from 'lucide-react';
import './DossierTab.css';

interface DossierTabProps {
  metadata: any;
  setMetadata: (m: any) => void;
  loadingHistory: boolean;
  historyList: any[];
  analytics: { prob?: string, est?: string };
  mapaContradicoes: any[];
  evaluatingVersions: boolean;
  evaluationResult: string | null;
  setEvaluationResult: (v: string | null) => void;
  isEditing: boolean;
  setIsEditing: (v: boolean) => void;
  result: string;
  setResult: (v: string) => void;
  copied: boolean;
  downloadingFormat: 'docx' | 'pdf' | null;
  carregarCaso: (id: string) => void;
  deletarCaso: (ids: string[]) => void;
  handleEvaluateVersions: () => void;
  handleToggleFavorite: (id: string, current: boolean) => void;
  salvarEdicaoDossier: () => void;
  handleDownload: (format: 'docx' | 'pdf') => void;
  handleCopy: () => void;
}

export default function DossierTab({
  metadata,
  setMetadata,
  loadingHistory,
  historyList,
  analytics,
  mapaContradicoes,
  evaluatingVersions,
  evaluationResult,
  setEvaluationResult,
  isEditing,
  setIsEditing,
  result,
  setResult,
  copied,
  downloadingFormat,
  carregarCaso,
  deletarCaso,
  handleEvaluateVersions,
  handleToggleFavorite,
  salvarEdicaoDossier,
  handleDownload,
  handleCopy,
}: DossierTabProps) {
  return (
    <div className="lx-single-panel">
      {!metadata.id ? (
        <>
          <div className="lx-card-header dossier-mb-lg">
            <div>
              <h3 className="dossier-header-title">Arquivo de Inteligência</h3>
              <p className="dossier-header-desc">Casos agrupados por cliente. Selecione um para ver todas as versões.</p>
            </div>
          </div>

          {loadingHistory ? (
            <div className="dossier-loading-wrap"><Loader2 className="lx-spin" size={32} /></div>
          ) : historyList.length === 0 ? (
            <div className="lx-card dossier-empty-card">
              <HistoryIcon size={48} className="dossier-empty-icon" />
              <p>O arquivo está vazio. Gere sua primeira peça para vê-la aqui.</p>
            </div>
          ) : (
            <div className="lx-history-grid">
              {/* Agrupamento por caseNumber */}
              {Object.values(historyList.reduce((acc: any, curr: any) => {
                const key = curr.caseNumber || curr.clientName || 'Sem Identificação';
                if (!acc[key]) acc[key] = [];
                acc[key].push(curr);
                return acc;
              }, {})).map((group: any) => {
                const latest = group[0]; // O backend já traz ordenado por data
                return (
                  <div key={latest.id} className="lx-history-card" onClick={() => carregarCaso(latest.id)}>
                    <div className="dossier-card-top-row">
                      <div className="dossier-card-title-group">
                        <div className="dossier-card-icon">
                          <BookOpen size={20} />
                        </div>
                        <div className="lx-history-title">{latest.clientName || 'Cliente sem nome'}</div>
                      </div>
                      <div className="lx-badge dossier-version-badge">
                        {group.length} {group.length > 1 ? 'Versões' : 'Versão'}
                      </div>
                    </div>

                    <div className="lx-history-client dossier-mt-sm">
                      <Clock size={14} />
                      <span>Proc: {latest.caseNumber || 'S/N'}</span>
                    </div>

                    <div className="lx-history-meta">
                      <div className="dossier-inline-meta">
                        <Calendar size={12} />
                        Última: {new Date(latest.createdAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div className="lx-history-actions">
                      <button className="lx-btn-tool dossier-btn-sm-text" onClick={(e) => { e.stopPropagation(); carregarCaso(latest.id); }}>
                        <Eye size={12} /> Abrir Dossiê
                      </button>
                      <button className="lx-btn-tool dossier-btn-danger-flat" title="Excluir dossiê" onClick={(e) => { e.stopPropagation(); deletarCaso(group.map((item: any) => item.id)); }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) /* Fim do historyList.map */}
        </>
      ) : (
        <div className="lx-dossier-layout">
          {/* Sidebar do Dossiê */}
          <div className="lx-dossier-sidebar">
            <button className="lx-btn-tool dossier-back-btn" onClick={() => setMetadata({})}>
              <X size={16} /> Voltar para a Lista
            </button>

            <div className="lx-dossier-info-card">
              <div className="dossier-mb-lg">
                <div className="lx-dossier-label">Cliente / Autor</div>
                <div className="lx-dossier-value dossier-value-lg">{metadata.cliente || 'N/A'}</div>
              </div>
              <div className="dossier-mb-lg">
                <div className="lx-dossier-label">Número do Processo</div>
                <div className="lx-dossier-value">{metadata.processo || 'N/A'}</div>
              </div>
              <div>
                <div className="lx-dossier-label">Data de Geração</div>
                <div className="lx-dossier-value">{metadata.criadoEm ? new Date(metadata.criadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : 'N/A'}</div>
              </div>
            </div>

            <div className="lx-stat-card dossier-stat-card-pad">
              <div className="lx-stat-label">Probabilidade de Êxito</div>
              <div className="lx-stat-value dossier-prob-value">
                {analytics.prob ? (analytics.prob.toString().includes('%') ? analytics.prob : `${analytics.prob}%`) : '??%'}
              </div>
            </div>

            {/* Seletor de Versões dentro do Dossiê */}
            {historyList.filter((h: any) => (h.caseNumber === metadata.processo && h.caseNumber) || (h.clientName === metadata.cliente && !metadata.processo)).length > 1 && (
              <div className="dossier-mt-lg">
                <div className="lx-dossier-label dossier-versions-header">
                  <span>Versões Disponíveis</span>
                  <button className="lx-btn-tool dossier-eval-btn" onClick={handleEvaluateVersions} disabled={evaluatingVersions}>
                    {evaluatingVersions ? <Loader2 className="lx-spin" size={12} /> : <Zap size={12} />}
                    Avaliar c/ IA
                  </button>
                </div>

                {evaluationResult && (
                  <div className="dossier-verdict-box">
                    <strong className="dossier-verdict-label">Veredito da IA:</strong>
                    <ReactMarkdown>{evaluationResult}</ReactMarkdown>
                    <button className="lx-btn-tool dossier-verdict-close-btn" onClick={() => setEvaluationResult(null)}>Fechar Veredito</button>
                  </div>
                )}

                <div className="dossier-versions-list">
                  {(() => {
                    const filteredVersions = historyList.filter((h: any) => (h.caseNumber === metadata.processo && h.caseNumber) || (h.clientName === metadata.cliente && !metadata.processo));

                    let bestIdx = -1;
                    let maxProb = -1;
                    let hasFavorite = false;

                    // 1. Verifica se o usuário favoritou manualmente alguma versão
                    filteredVersions.forEach((v: any, idx: number) => {
                      if (v.isFavorite) {
                        bestIdx = idx;
                        hasFavorite = true;
                      }
                    });

                    // 2. Se não tem favorito, pega a com maior probabilidade
                    if (!hasFavorite) {
                      filteredVersions.forEach((v: any, idx: number) => {
                        const vAna = typeof v.analytics === 'string' ? JSON.parse(v.analytics) : (v.analytics || {});
                        const probInt = parseInt(String(vAna.prob || '0').replace(/[^0-9]/g, '')) || 0;
                        if (probInt > maxProb && probInt > 0) {
                          maxProb = probInt;
                          bestIdx = idx;
                        }
                      });
                    }

                    return filteredVersions.map((v: any, idx: number, arr: any[]) => {
                      const isBest = (idx === bestIdx);

                      return (
                        <div key={v.id} className="dossier-version-row">
                          <button
                            onClick={() => carregarCaso(v.id)}
                            className={`lx-btn-tool dossier-version-btn ${metadata.id === v.id ? 'active' : ''}`}
                          >
                            <div className="dossier-version-date-row">
                              <Clock size={12} />
                              <span>{new Date(v.createdAt).toLocaleDateString()} - v{arr.length - idx}</span>
                            </div>
                            {isBest && (
                              <div className="lx-badge dossier-best-badge">
                                MELHOR OPÇÃO
                              </div>
                            )}
                          </button>
                          <button
                            className="lx-btn-tool dossier-fav-btn"
                            onClick={(e) => { e.stopPropagation(); handleToggleFavorite(v.id, v.isFavorite); }}
                            title="Favoritar versão"
                          >
                            <Star size={16} color={v.isFavorite ? 'var(--gold)' : 'var(--text-muted)'} fill={v.isFavorite ? 'var(--gold)' : 'none'} />
                          </button>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            <button className={`lx-btn-generate ${isEditing ? 'success' : ''}`} onClick={() => isEditing ? salvarEdicaoDossier() : setIsEditing(true)} style={{ background: isEditing ? '#10b981' : '' }}>
              {isEditing ? <Save size={18} /> : <Edit3 size={18} />}
              {isEditing ? 'Salvar Alterações' : 'Editar Petição'}
            </button>

            {!isEditing && (
              <div className="dossier-download-grid">
                <button className="lx-btn-tool lx-btn-tool-highlight dossier-word-btn" onClick={() => handleDownload('docx')} disabled={!!downloadingFormat}>
                  {downloadingFormat === 'docx' ? <Loader2 className="lx-spin" size={16} /> : <Download size={16} />}
                  Word
                </button>
                <button className="lx-btn-tool lx-btn-tool-highlight dossier-pdf-btn" onClick={() => handleDownload('pdf')} disabled={!!downloadingFormat}>
                  {downloadingFormat === 'pdf' ? <Loader2 className="lx-spin" size={16} /> : <FileText size={16} />}
                  PDF
                </button>
              </div>
            )}

            {isEditing && (
              <button className="lx-btn-tool dossier-cancel-btn" onClick={() => setIsEditing(false)}>
                Cancelar
              </button>
            )}
          </div>

          {/* Conteúdo Principal do Dossiê */}
          <div className="lx-dossier-main">

            {/* Mapa de Contradições – Premium (Dossiê) */}
            <div className="lx-dossier-timeline-card">
              <div className="lx-dossier-timeline-header">
                <div className="lx-dossier-timeline-header-icon dossier-timeline-icon-tint">
                  <Target size={16} />
                </div>
                <div>
                  <div className="lx-dossier-timeline-header-title">Dossiê Estratégico</div>
                  <div className="lx-dossier-timeline-header-sub">{mapaContradicoes.length} contra-argumentos detectados</div>
                </div>
                <div className="lx-dossier-timeline-count">{mapaContradicoes.length} CONFLITOS</div>
              </div>

              <div className="lx-dossier-timeline-body">
                {mapaContradicoes.length > 0 ? (
                  <div className="lx-conflict-grid-dossier">
                    {mapaContradicoes.map((c: any, i: number) => (
                      <div key={i} className="lx-conflict-card">
                        <div className="lx-conflict-point">
                          <span className={`lx-conflict-tag lx-conflict-tag-${(c.gravidade || 'MÉDIO').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "")}`}>{c.gravidade || 'MÉDIO'}</span>
                          {c.ponto}
                        </div>
                        <div className="lx-conflict-duo">
                          <div className="lx-conflict-side lx-conflict-side-adv">
                            <div className="lx-conflict-label">Versão Adversa</div>
                            <p>{c.versaoAdversa}</p>
                          </div>
                          <div className="lx-conflict-side lx-conflict-side-def">
                            <div className="lx-conflict-label">Nossa Prova</div>
                            <p>{c.versaoDefesa}</p>
                          </div>
                        </div>
                        <div className="lx-conflict-weapon">
                          <Sword size={12} />
                          <strong>ARMA:</strong> {c.prova}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="lx-audit-empty-state dossier-empty-audit">Aguardando análise de contradições...</div>
                )}
              </div>
            </div>

            <div className="dossier-spacer" />
            {/* Preview da Peça / Editor */}
            <div className="lx-dossier-peca-card">
              <div className="lx-dossier-peca-header">
                <div className="lx-dossier-peca-header-icon">
                  <FileText size={16} />
                </div>
                <div>
                  <div className="lx-dossier-peca-header-title">{isEditing ? 'Editando Peça Técnica' : 'Visualização da Peça Técnica'}</div>
                  <div className="lx-dossier-peca-header-sub">Documento gerado por IA · Jurisprudência aplicada</div>
                </div>
                {!isEditing && (
                  <button className="lx-dossier-peca-copy-btn" onClick={handleCopy}>
                    {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                    {copied ? 'Copiado!' : 'Copiar'}
                  </button>
                )}
              </div>
              <div className="lx-dossier-editor-container dossier-editor-min-height">
                {isEditing ? (
                  <textarea
                    className="lx-dossier-native-editor"
                    value={result}
                    onChange={(e) => setResult(e.target.value)}
                    placeholder="Digite ou cole o texto da petição aqui..."
                    spellCheck={false}
                  />
                ) : (
                  <div className="lx-markdown-preview dossier-preview-bordered">
                    <ReactMarkdown>{result}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
