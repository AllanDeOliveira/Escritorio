import { useState, useEffect, useCallback } from 'react';
import {
  Search, Loader2, AlertTriangle, TrendingUp,
  TrendingDown, CheckCircle, Scale, Activity, Thermometer, ChevronRight, X, ShieldAlert, Layers, Target, Trash2
} from 'lucide-react';

import { jurimetriaService } from './services/jurimetriaService';
import type { JurimetriaDataPayload } from './services/jurimetriaService';
import type { TeseInfoUI } from './utils/jurimetriaMappers';

/**
 * Componente Principal da Tela de Jurimetria.
 * Gerencia o estado das Áreas de Monitoramento, Análises Gerais e Análises de Desfechos.
 */
export default function Jurimetria() {
  const [dataPayload, setDataPayload] = useState<JurimetriaDataPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTese, setSelectedTese] = useState<TeseInfoUI | null>(null);
  
  // Novas states para Monitoramento Automatizado
  const [areas, setAreas] = useState<any[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [showNovaAreaModal, setShowNovaAreaModal] = useState(false);
  const [novaAreaForm, setNovaAreaForm] = useState({
    name: '', courtAcronym: 'TJSP', subjectCode: '',
    // Extensões do filtro de descoberta — sem elas, cai no padrão (últimos 30 dias, 1 assunto).
    outrosAssuntos: '', dataInicio: '', dataFim: '', classCode: '',
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [outcomeAnalyses, setOutcomeAnalyses] = useState<any[]>([]);
  const [loadingOutcome, setLoadingOutcome] = useState(false);
  const [waitingTese, setWaitingTese] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  /**
   * Re-enfileira a análise da área quando ela travou (pipeline falhou e nunca gerou resultado).
   * O polling existente detecta o resultado assim que a IA terminar.
   */
  const handleRescan = async () => {
    if (!selectedAreaId || rescanning) return;
    setRescanning(true);
    const ok = await jurimetriaService.rescanArea(selectedAreaId);
    setRescanning(false);
    if (!ok) alert('Não foi possível reiniciar a análise. Tente novamente em instantes.');
  };

  /**
   * Carrega a lista de Áreas de Monitoramento cadastradas no backend.
   */
  const carregarAreas = useCallback(async () => {
    const list = await jurimetriaService.fetchMonitoringAreas();
    setAreas(list);
    if (list.length > 0 && !selectedAreaId) {
      setSelectedAreaId(list[0].id);
    }
  }, [selectedAreaId]);

  /**
   * Carrega o histórico de análises de desfechos (ganho/perda) para a área selecionada.
   */
  const carregarOutcomes = useCallback(async () => {
    if (!selectedAreaId) return;
    const list = await jurimetriaService.fetchOutcomeAnalyses(selectedAreaId);
    setOutcomeAnalyses(list);
  }, [selectedAreaId]);

  /**
   * Carrega a análise jurimétrica geral (radar e termômetro) da área selecionada.
   */
  const carregarDados = useCallback(async () => {
    setLoading(true);
    setIsAnalyzing(false);
    setError(null);
    try {
      if (selectedAreaId) {
        const analysisData = await jurimetriaService.fetchAreaAnalysis(selectedAreaId);
        if (analysisData && analysisData.analysis) {
          setDataPayload(analysisData.analysis);
        } else {
          setDataPayload(null);
          setIsAnalyzing(true);
        }
      } else {
        // Quando nenhuma área está selecionada, limpamos os dados da tela
        setDataPayload(null);
      }
      if (selectedTese) setSelectedTese(null);
    } catch (err: any) {
      setError(err.message || "Erro desconhecido ao carregar dados do tribunal.");
    } finally {
      setLoading(false);
    }
  }, [selectedAreaId]);

  useEffect(() => {
    carregarAreas();
  }, [carregarAreas]);

  useEffect(() => {
    if (selectedAreaId) {
      carregarOutcomes();
    }
  }, [carregarOutcomes, selectedAreaId]);

  useEffect(() => {
    if (areas.length > 0 || !selectedAreaId) {
      carregarDados();
    }
  }, [carregarDados, selectedAreaId, areas.length]);

  // Polling para Análise Geral
  useEffect(() => {
    let interval: any;
    if (isAnalyzing && selectedAreaId) {
      interval = setInterval(async () => {
        const analysisData = await jurimetriaService.fetchAreaAnalysis(selectedAreaId);
        if (analysisData && analysisData.analysis) {
          setDataPayload(analysisData.analysis);
          setIsAnalyzing(false);
        }
      }, 10000); // Checa a cada 10 segundos
    }
    return () => clearInterval(interval);
  }, [isAnalyzing, selectedAreaId]);

  // Polling para Análise de Desfechos
  useEffect(() => {
    let interval: any;
    if (waitingTese && selectedAreaId) {
      interval = setInterval(async () => {
        const list = await jurimetriaService.fetchOutcomeAnalyses(selectedAreaId);
        // Verifica se já existe uma análise para essa tese com resultados salvos
        const found = list.find((oa: any) => oa.teseName === waitingTese && (oa.results?.length > 0 || oa.statistics?.successRate > 0));
        if (found) {
          setOutcomeAnalyses(list);
          setWaitingTese(null);
          setLoadingOutcome(false);
        }
      }, 5000); // Checa a cada 5 segundos
    }
    return () => clearInterval(interval);
  }, [waitingTese, selectedAreaId]);

  /**
   * Cria uma nova Área de Monitoramento.
   */
  const handleCreateArea = async () => {
    try {
      const subjectCodes = novaAreaForm.outrosAssuntos
        .split(',').map(s => s.trim()).filter(Boolean);
      await jurimetriaService.createMonitoringArea({
        name: novaAreaForm.name,
        courtAcronym: novaAreaForm.courtAcronym,
        subjectCode: novaAreaForm.subjectCode,
        filters: {
          ...(subjectCodes.length > 0 ? { subjectCodes } : {}),
          ...(novaAreaForm.dataInicio ? { startDate: novaAreaForm.dataInicio } : {}),
          ...(novaAreaForm.dataFim ? { endDate: novaAreaForm.dataFim } : {}),
          ...(novaAreaForm.classCode ? { classCode: novaAreaForm.classCode } : {}),
        },
      });
      setShowNovaAreaModal(false);
      setNovaAreaForm({ name: '', courtAcronym: 'TJSP', subjectCode: '', outrosAssuntos: '', dataInicio: '', dataFim: '', classCode: '' });
      await carregarAreas();
    } catch (e: any) {
      alert("Erro ao criar área de monitoramento: " + (e.message || "Erro desconhecido"));
    }
  };

  /**
   * Dispara o processamento da IA Deep para analisar desfechos de uma tese específica.
   */
  const handleTriggerOutcome = async () => {
    if (!selectedAreaId || !selectedTese) return;
    setLoadingOutcome(true);
    setWaitingTese(selectedTese.nome);
    try {
      const success = await jurimetriaService.triggerOutcomeAnalysis(selectedAreaId, selectedTese.nome);
      if (!success) {
        alert("Erro ao enfileirar análise.");
        setLoadingOutcome(false);
        setWaitingTese(null);
      }
      // O Polling via useEffect cuidará de finalizar o loading e mostrar os dados
    } catch (e) {
      alert("Erro de conexão.");
      setLoadingOutcome(false);
      setWaitingTese(null);
    }
  };

  const handleDeleteArea = async () => {
    if (!selectedAreaId) return;
    (window as any).showConfirm("Tem certeza que deseja excluir esta área de monitoramento? Todos os dados de análise vinculados serão perdidos.", async () => {
      try {
        const success = await jurimetriaService.deleteMonitoringArea(selectedAreaId);
        if (success) {
          setSelectedAreaId(null);
          await carregarAreas();
        } else {
          alert("Erro ao excluir área.");
        }
      } catch (e) {
        alert("Erro de conexão ao excluir área.");
      }
    });
  };

  const teses = dataPayload?.teses || [];
  const radar = dataPayload?.radar || [];
  const metrics = dataPayload?.metrics || { totalTeses: 0, emAscensao: 0, consolidadas: 0, risco: 0 };

  return (
    <div className="lx-jurimetria-container">
      {/* Modal Nova Área */}
      {showNovaAreaModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="lx-card" style={{ width: '400px', padding: '1.5rem' }}>
            <h3 style={{ marginTop: 0 }}>Nova Área de Monitoramento</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <input type="text" placeholder="Nome da Área (ex: Direito Bancário)" value={novaAreaForm.name} onChange={e => setNovaAreaForm({...novaAreaForm, name: e.target.value})} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
              <input type="text" placeholder="Sigla do Tribunal (ex: TJSP, STF)" value={novaAreaForm.courtAcronym} onChange={e => setNovaAreaForm({...novaAreaForm, courtAcronym: e.target.value})} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
              <input type="text" placeholder="Código Assunto TPU (opcional)" value={novaAreaForm.subjectCode} onChange={e => setNovaAreaForm({...novaAreaForm, subjectCode: e.target.value})} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
              <input type="text" placeholder="Outros códigos de assunto (separados por vírgula)" value={novaAreaForm.outrosAssuntos} onChange={e => setNovaAreaForm({...novaAreaForm, outrosAssuntos: e.target.value})} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
              <input type="text" placeholder="Código da Classe Processual (opcional)" value={novaAreaForm.classCode} onChange={e => setNovaAreaForm({...novaAreaForm, classCode: e.target.value})} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Período (opcional — sem isso, busca os últimos 30 dias)</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="date" value={novaAreaForm.dataInicio} onChange={e => setNovaAreaForm({...novaAreaForm, dataInicio: e.target.value})} style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                  <input type="date" value={novaAreaForm.dataFim} onChange={e => setNovaAreaForm({...novaAreaForm, dataFim: e.target.value})} style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button className="lx-btn-tool" onClick={() => setShowNovaAreaModal(false)}>Cancelar</button>
                <button className="lx-btn-primary" onClick={handleCreateArea}>Salvar e Monitorar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cabeçalho de Áreas */}
      <div className="lx-card" style={{ marginBottom: '1.5rem', padding: '1.25rem', borderLeft: '4px solid var(--primary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Target size={24} color="var(--primary)" />
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Radar Preditivo Automatizado</h2>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>A IA escuta o DataJud e sumariza padrões em tempo real.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <select 
                value={selectedAreaId || ''} 
                onChange={e => setSelectedAreaId(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '4px', background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              >
                <option value="">Selecione uma área...</option>
                {areas.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.courtAcronym})</option>
                ))}
              </select>
              {selectedAreaId && (
                <button 
                  className="lx-btn-icon" 
                  onClick={handleDeleteArea}
                  title="Excluir Área Selecionada"
                  style={{ color: 'var(--error)', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <button className="lx-btn-primary" onClick={() => setShowNovaAreaModal(true)}>+ Nova Área</button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="lx-card lx-empty" style={{ borderColor: 'var(--error)' }}>
          <AlertTriangle size={48} color="var(--error)" opacity={0.8} style={{ marginBottom: '1rem' }} />
          <h3 style={{ color: 'var(--error)', margin: '0 0 0.5rem 0' }}>Falha na Integração Oficial</h3>
          <p style={{ margin: 0 }}>{error}</p>
          <button className="lx-btn-tool" style={{ marginTop: '1rem' }} onClick={carregarDados}>Tentar Novamente</button>
        </div>
      ) : isAnalyzing ? (
        <div className="lx-card lx-empty" style={{ border: '2px dashed var(--primary)', background: 'rgba(212, 175, 55, 0.02)' }}>
          <Activity size={48} className="lx-spin" color="var(--primary)" style={{ marginBottom: '1rem' }} />
          <h3 style={{ color: 'var(--primary)', margin: '0 0 0.5rem 0' }}>IA Gerando Análise Preditiva...</h3>
          <p style={{ margin: 0, maxWidth: '500px', textAlign: 'center' }}>
            Estamos coletando processos recentes do DataJud e analisando padrões de teses. 
            Isso pode levar de 1 a 2 minutos para a primeira execução.
          </p>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
             <button className="lx-btn-primary" onClick={handleRescan} disabled={rescanning}>
               {rescanning ? <Loader2 className="lx-spin" size={16} /> : <Search size={16} />}
               {rescanning ? 'Reiniciando...' : 'Refazer Análise'}
             </button>
          </div>
        </div>
      ) : loading ? (
        <div className="lx-card lx-empty">
          <Loader2 size={48} className="lx-spin" color="var(--primary)" style={{ marginBottom: '1rem' }} />
          <h3 style={{ color: 'var(--text-primary)', margin: '0 0 0.5rem 0' }}>Conectando às Fontes Oficiais...</h3>
          <p style={{ margin: 0 }}>Buscando e processando dados do DataJud via API pública.</p>
        </div>
      ) : !selectedAreaId ? (
        <div className="lx-card lx-empty" style={{ border: '1px dashed var(--border)', background: 'transparent' }}>
          <Target size={48} color="var(--text-muted)" style={{ marginBottom: '1rem', opacity: 0.5 }} />
          <h3 style={{ color: 'var(--text-secondary)', margin: '0 0 0.5rem 0' }}>Nenhuma Área Selecionada</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Selecione uma área de monitoramento acima ou crie uma nova para ver a análise da IA.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {/* Cards Executivos */}
            <div className="lx-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', fontWeight: 600 }}>Teses Monitoradas</div>
                <Activity size={18} color="var(--primary)" />
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>{metrics.totalTeses.toLocaleString()}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--success)', fontSize: '0.8rem', fontWeight: 600 }}>
                <TrendingUp size={14} /> Detectado do DataJud
              </div>
            </div>

            <div className="lx-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', fontWeight: 600 }}>Teses em Ascensão</div>
                <Thermometer size={18} color="#10b981" />
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>{metrics.emAscensao}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                Tendência &gt; 10% (Derivado)
              </div>
            </div>

            <div className="lx-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', fontWeight: 600 }}>Teses Consolidadas</div>
                <CheckCircle size={18} color="#0284c7" />
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>{metrics.consolidadas}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                Jurisprudência estagnada
              </div>
            </div>

            <div className="lx-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', fontWeight: 600 }}>Teses de Risco</div>
                <AlertTriangle size={18} color="#ef4444" />
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>{metrics.risco}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--error)', fontSize: '0.8rem', fontWeight: 600 }}>
                Alto volume detectado
              </div>
            </div>
          </div>

          <div className="lx-jurimetria-grid">
            {/* Lado Esquerdo: Explorer e Termômetro */}
            <div className="lx-jurimetria-main">
              
              {/* Termômetro de Teses */}
              <div className="lx-card" style={{ marginBottom: '1.5rem' }}>
                <div className="lx-card-header">
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Layers size={18} color="var(--primary)" /> Termômetro de Teses (Base DataJud)</h3>
                </div>
                <div className="lx-table-container">
                  {teses.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum dado retornado da fonte oficial para este filtro.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          <th style={{ padding: '1rem', fontWeight: 600 }}>Assunto (TPU)</th>
                          <th style={{ padding: '1rem', fontWeight: 600 }}>Volume</th>
                          <th style={{ padding: '1rem', fontWeight: 600 }} title="Movimentações nos últimos 30 dias vs. os 30 anteriores">Atividade (30d)</th>
                          <th style={{ padding: '1rem', fontWeight: 600 }}>Status</th>
                          <th style={{ padding: '1rem', fontWeight: 600 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {teses.map((tese) => (
                          <tr key={tese.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'var(--t)' }} className="lx-table-row-hover" onClick={() => setSelectedTese(tese)}>
                            <td style={{ padding: '1rem', fontWeight: 500, maxWidth: '300px' }}>
                              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={tese.nome}>{tese.nome}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Polo (Estimado): {tese.entidade}</div>
                            </td>
                            <td style={{ padding: '1rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{tese.volume.toLocaleString()} processos</td>
                            <td style={{ padding: '1rem' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: tese.tendencia > 0 ? 'var(--success)' : tese.tendencia < 0 ? 'var(--error)' : 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600 }}>
                                {tese.tendencia >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {tese.tendencia > 0 ? '+' : tese.tendencia < 0 ? '−' : ''}{Math.abs(tese.tendencia)}%
                              </span>
                            </td>
                            <td style={{ padding: '1rem' }}>
                              {tese.status === 'ascensao' && <span className="lx-status-badge lx-status-ascensao">Em Ascensão</span>}
                              {tese.status === 'consolidada' && <span className="lx-status-badge lx-status-consolidada">Consolidada</span>}
                              {tese.status === 'risco' && <span className="lx-status-badge lx-status-risco">De Risco</span>}
                            </td>
                            <td style={{ padding: '1rem', textAlign: 'right' }}>
                              <button className="lx-btn-icon"><ChevronRight size={18} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>



            </div>

            {/* Lado Direito: Radar de Superiores e Painel de Detalhes */}
            <div className="lx-jurimetria-side">
              
              {selectedTese ? (
                /* Painel Lateral de Explicabilidade */
                <div className="lx-card" style={{ height: '100%', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-active)', boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}>
                  <div className="lx-card-header" style={{ padding: '1.25rem', borderBottom: '1px solid var(--border)', margin: 0, background: 'var(--bg-input)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Target size={18} color="#D4AF37" />
                      <h3 style={{ margin: 0 }}>Análise da Tese</h3>
                    </div>
                    <button onClick={() => setSelectedTese(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
                  </div>
                  
                  <div style={{ padding: '1.25rem', flex: 1, overflowY: 'auto' }}>
                    <div style={{ marginBottom: '1.5rem' }}>
                      {selectedTese.status === 'ascensao' && <span className="lx-status-badge lx-status-ascensao" style={{ marginBottom: '0.5rem', display: 'inline-flex' }}>Em Ascensão</span>}
                      {selectedTese.status === 'consolidada' && <span className="lx-status-badge lx-status-consolidada" style={{ marginBottom: '0.5rem', display: 'inline-flex' }}>Consolidada</span>}
                      {selectedTese.status === 'risco' && <span className="lx-status-badge lx-status-risco" style={{ marginBottom: '0.5rem', display: 'inline-flex' }}>De Risco</span>}
                      
                      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: 'var(--primary)', lineHeight: 1.3 }}>{selectedTese.nome}</h2>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>Alvo estimado: <strong>{selectedTese.entidade}</strong></p>
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                      <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        Resumo Semântico <span title="Dado não presente no DataJud"><AlertTriangle size={12} color="var(--text-muted)" /></span>
                      </h4>
                      <p style={{ fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--text-secondary)', background: 'var(--bg-input)', padding: '1rem', borderRadius: 'var(--r-sm)', fontStyle: 'italic' }}>
                        {selectedTese.resumo}
                      </p>
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                      <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Fundamentos Recorrentes</h4>
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {selectedTese.fundamentos.map((f, i) => (
                          <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                            <Scale size={14} color="#D4AF37" /> {f}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Justificativa do Status</h4>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'flex-start', gap: '0.75rem', background: 'rgba(212, 175, 55, 0.05)', padding: '1rem', borderRadius: 'var(--r-sm)', border: '1px solid rgba(212, 175, 55, 0.2)' }}>
                        <ShieldAlert size={16} color="#D4AF37" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <div>
                          {selectedTese.movRecente != null && selectedTese.movAnterior != null ? (
                            <>Foram <strong>{selectedTese.movRecente}</strong> movimentações nos últimos 30 dias contra <strong>{selectedTese.movAnterior}</strong> nos 30 anteriores ({selectedTese.tendencia > 0 ? '+' : ''}{selectedTese.tendencia}%), em <strong>{selectedTese.volume}</strong> processos monitorados no DataJud.</>
                          ) : (
                            <>Variação de <strong>{selectedTese.tendencia}%</strong> na atividade processual (movimentações) dos últimos 30 dias em relação aos 30 anteriores.</>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: '2rem' }}>
                      <button 
                        className="lx-btn-primary" 
                        style={{ width: '100%', padding: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                        onClick={handleTriggerOutcome}
                        disabled={loadingOutcome}
                      >
                        {loadingOutcome ? <Loader2 size={16} className="lx-spin" /> : <Activity size={16} />}
                        Análise de Desfechos (IA Deep)
                      </button>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.5rem' }}>
                        Extrai taxas de deferimento e datas de julgamento reais.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                /* Radar de Superiores (STF/STJ) */
                <div className="lx-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div className="lx-card-header" style={{ display: 'block' }}>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}><Scale size={18} color="var(--primary)" /> Radar STJ — Assuntos da Área</h3>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
                      Processos reais com movimentação recente no STJ sobre os assuntos desta área. Fonte: DataJud/CNJ.
                    </p>
                  </div>
                  <div style={{ padding: '0 1rem 1rem 1rem', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {radar.length === 0 ? (
                      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum precedente relevante detectado para o contexto atual.</div>
                    ) : (
                      radar.map((item) => (
                        <div key={item.id} className="lx-card lx-table-row-hover" style={{ padding: '1rem', borderLeft: `4px solid ${item.impacto === 'alto' ? '#ef4444' : '#f59e0b'}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'var(--bg-input)' }}>{item.tribunal}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.data}</span>
                          </div>
                          <h4 style={{ fontSize: '0.85rem', margin: '0 0 0.5rem 0', lineHeight: 1.4 }}>{item.titulo}</h4>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{item.tipo}</span>
                            <span style={{ fontWeight: 600, color: item.impacto === 'alto' ? '#ef4444' : '#f59e0b' }}>Impacto {item.impacto.charAt(0).toUpperCase() + item.impacto.slice(1)}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* NOVA SEÇÃO: Resultados de Desfechos */}
          {outcomeAnalyses.length > 0 && (
            <div className="lx-card" style={{ marginTop: '1.5rem' }}>
              <div className="lx-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}><Activity size={18} color="var(--primary)" /> Análise Profunda de Desfechos (Teses Específicas)</h3>
                <button 
                  onClick={() => setOutcomeAnalyses([])}
                  style={{ 
                    background: 'transparent', 
                    border: 'none', 
                    cursor: 'pointer', 
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0.5rem'
                  }}
                  title="Fechar análise"
                >
                  <X size={20} />
                </button>
              </div>
              <div style={{ padding: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                  {outcomeAnalyses
                    .filter(oa => oa.teseName === selectedTese?.nome)
                    .map((oa) => (
                    <div key={oa.id} className="lx-card" style={{ padding: '1.25rem', background: 'var(--bg-input)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h4 style={{ margin: 0, color: 'var(--primary)' }}>Tese: {oa.teseName}</h4>
                        <span className="lx-status-badge lx-status-ascensao" style={{ background: 'var(--success)', color: '#fff' }}>{oa.statistics.successRate}% Sucesso</span>
                      </div>
                      
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Linha do Tempo (Decisões/Mês)</div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', height: '40px' }}>
                          {Object.entries(oa.statistics.timeline).map(([month, count]: [string, any]) => (
                            <div key={month} title={`${month}: ${count}`} style={{ flex: 1, background: 'var(--primary)', height: `${Math.min(100, (count / 10) * 100)}%`, borderRadius: '2px 2px 0 0' }}></div>
                          ))}
                        </div>
                      </div>

                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        <strong>Ponto de Inflexão:</strong> {oa.statistics.inflectionPoint || 'Estável'}
                      </div>

                      <div style={{ marginTop: '1rem', maxHeight: '150px', overflowY: 'auto', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.5rem' }}>Recortes Recentes:</div>
                        {oa.results.slice(0, 3).map((r: any, idx: number) => (
                          <div key={idx} style={{ fontSize: '0.75rem', marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px dashed var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <strong>{r.data_decisao}</strong>
                              <span style={{ color: r.resultado.includes('Deferida') ? 'var(--success)' : 'var(--error)' }}>{r.resultado}</span>
                            </div>
                            <div style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>"{r.trecho_decisivo}"</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
