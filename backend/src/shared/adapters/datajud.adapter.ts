import { BaseLegalAdapter } from './legal-adapter.interface';
import { ProcessType, MovementType } from '../types';

/**
 * Adaptador para interação com a API Pública do DataJud (CNJ).
 * Responsável por buscar detalhes de processos individuais e realizar buscas por lotes.
 */
export class DataJudAdapter implements BaseLegalAdapter {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = (apiKey || process.env.DATAJUD_API_KEY || '').trim();
  }

  /**
   * Busca os detalhes completos de um processo específico pelo seu número CNJ.
   * Identifica automaticamente o tribunal correto para direcionar a requisição.
   */
  async fetchProcess(cnj: string) {
    if (!this.apiKey) {
      throw new Error('DATAJUD_API_KEY is missing');
    }

    const payload = {
      query: {
        match: {
          numeroProcesso: cnj.replace(/\D/g, '') // DataJud usa CNJ sem máscara
        }
      }
    };

    const match = cnj.match(/\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}/);
    let indexName = 'api_publica_tjsp'; // fallback
    if (match) {
      const justica = match[1];
      const tribunal = match[2];
      if (justica === '8') {
        const mapaTj: Record<string, string> = {
          '01': 'tjac', '02': 'tjal', '03': 'tjam', '04': 'tjap', '05': 'tjba',
          '06': 'tjce', '07': 'tjdft', '08': 'tjes', '09': 'tjgo', '10': 'tjma',
          '11': 'tjmt', '12': 'tjms', '13': 'tjmg', '14': 'tjpa', '15': 'tjpb',
          '16': 'tjpr', '17': 'tjpe', '18': 'tjpi', '19': 'tjrj', '20': 'tjrn',
          '21': 'tjrs', '22': 'tjro', '23': 'tjrr', '24': 'tjsc', '25': 'tjse',
          '26': 'tjsp', '27': 'tjto'
        };
        const sigla = mapaTj[tribunal];
        if (sigla) {
          indexName = `api_publica_${sigla}`;
        }
      }
    }

    const url = `https://api-publica.datajud.cnj.jus.br/${indexName}/_search`;
    console.log(`[DataJudAdapter] Fetching from ${url}`);
    console.log(`[DataJudAdapter] API Key used: ${this.apiKey.substring(0, 5)}...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `APIKey ${this.apiKey}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[DataJudAdapter] HTTP ${response.status} Error body:`, errorBody);
      const error: any = new Error(`DataJud API Error: ${response.statusText}`);
      error.status = response.status;
      throw error;
    }

    const rawPayload = await response.json();
    const hits = rawPayload?.hits?.hits || [];
    
    if (hits.length === 0) {
      throw new Error('Processo não encontrado no DataJud');
    }

    const source = hits[0]._source;

    const parseDate = (d: any) => {
      if (!d) return undefined;
      const date = new Date(d);
      return isNaN(date.getTime()) ? undefined : date;
    };

    // Assunto TPU principal (matéria jurídica real) — base para agrupar teses na jurimetria
    const assuntoPrincipal = Array.isArray(source.assuntos) ? source.assuntos[0] : undefined;

    const process: Partial<ProcessType> = {
      cnjNumber: cnj,
      filingDate: parseDate(source.dataAjuizamento),
      classId: String(source.classe?.codigo || ''),
      className: source.classe?.nome || 'Desconhecida',
      subjectCode: assuntoPrincipal?.codigo != null ? String(assuntoPrincipal.codigo) : undefined,
      subjectName: assuntoPrincipal?.nome || undefined
    };

    const movements: Partial<MovementType>[] = (source.movimentos || []).map((mov: any) => ({
      date: parseDate(mov.dataHora) || new Date(),
      code: String(mov.movimentoNacional?.codigoNacional || mov.codigo || ''),
      description: mov.nome || mov.movimentoLocal?.descricao || 'Movimentação sem descrição'
    }));

    return { process, movements, rawPayload };
  }

  /**
   * Realiza uma busca por processos recentes baseada em filtros de tribunal,
   * código(s) de assunto (TPU), classe processual e período de tempo.
   *
   * `subjectCode`/`daysAgo` continuam aceitos (compat com chamadas antigas);
   * `subjectCodes`/`startDate`/`endDate`/`classCode` são as extensões novas.
   * Quando `startDate`/`endDate` vêm preenchidos, prevalecem sobre `daysAgo`.
   */
  async searchProcesses(filters: {
    courtAcronym: string,
    subjectCode?: string,
    subjectCodes?: string[],
    daysAgo?: number,
    startDate?: string,
    endDate?: string,
    classCode?: string,
  }): Promise<string[]> {
    if (!this.apiKey) {
      throw new Error('DATAJUD_API_KEY is missing');
    }

    const indexName = `api_publica_${filters.courtAcronym.toLowerCase()}`;
    const url = `https://api-publica.datajud.cnj.jus.br/${indexName}/_search`;

    const mustClauses: any[] = [];

    // campo correto no índice é assuntos.codigo (codigoNacional não existe → 0 hits)
    const subjectCodes = Array.from(new Set([
      ...(filters.subjectCode ? [filters.subjectCode] : []),
      ...(filters.subjectCodes || []),
    ])).map(c => parseInt(c, 10)).filter(n => !isNaN(n));
    if (subjectCodes.length > 0) {
      mustClauses.push({ terms: { "assuntos.codigo": subjectCodes } });
    }

    if (filters.classCode) {
      const classCode = parseInt(filters.classCode, 10);
      if (!isNaN(classCode)) {
        mustClauses.push({ term: { "classe.codigo": classCode } });
      }
    }

    if (filters.startDate || filters.endDate) {
      const range: { gte?: string, lte?: string } = {};
      if (filters.startDate) range.gte = new Date(filters.startDate).toISOString();
      if (filters.endDate) range.lte = new Date(filters.endDate).toISOString();
      mustClauses.push({ range: { "dataAjuizamento": range } });
    } else if (filters.daysAgo) {
      const date = new Date();
      date.setDate(date.getDate() - filters.daysAgo);
      mustClauses.push({
        range: { "dataAjuizamento": { "gte": date.toISOString() } }
      });
    }

    const payload = {
      query: {
        bool: {
          must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }]
        }
      },
      size: 100, // Aumentado para 100 conforme solicitado
      sort: [{ "dataAjuizamento": "desc" }]
    };

    console.log(`[DataJudAdapter] Searching ${indexName} — assuntos:${subjectCodes.join(',') || '-'} classe:${filters.classCode || '-'} periodo:${filters.startDate || filters.daysAgo + 'd atrás' || '-'}..${filters.endDate || 'hoje'}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `APIKey ${this.apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.error(`[DataJudAdapter] Search HTTP ${response.status}`);
        if (response.status === 429) {
          const error: any = new Error('DataJud API Error: Too Many Requests');
          error.status = 429;
          throw error;
        }
        return [];
      }

      const rawPayload = await response.json();
      const hits = rawPayload?.hits?.hits || [];
      
      // Retorna apenas os CNJs encontrados, formatados
      return hits.map((hit: any) => {
        const num = hit._source.numeroProcesso;
        // Tentar formatar se vier apenas números
        if (num && num.length === 20 && !num.includes('-')) {
          return `${num.slice(0,7)}-${num.slice(7,9)}.${num.slice(9,13)}.${num.slice(13,14)}.${num.slice(14,16)}.${num.slice(16,20)}`;
        }
        return num;
      }).filter(Boolean);

    } catch (e: any) {
      if (e.status === 429) throw e; // deixa o BullMQ re-tentar com backoff em vez de engolir
      console.error(`[DataJudAdapter] Search failed:`, e);
      return [];
    }
  }

  /**
   * Busca processos recentes no STJ que tratam dos assuntos (códigos TPU) informados.
   * Fonte real para o Radar da jurimetria — substitui precedentes gerados por IA.
   */
  async searchRecentSTJ(subjectCodes: string[], size = 20): Promise<Array<{
    numeroProcesso: string;
    classeNome: string;
    assuntoCodigo: string;
    assuntoNome: string;
    ultimaAtualizacao?: string;
  }>> {
    if (!this.apiKey) {
      throw new Error('DATAJUD_API_KEY is missing');
    }
    const codes = subjectCodes.map(c => parseInt(c, 10)).filter(n => !isNaN(n));
    if (codes.length === 0) return [];

    const url = 'https://api-publica.datajud.cnj.jus.br/api_publica_stj/_search';
    const payload = {
      query: { terms: { 'assuntos.codigo': codes } },
      size,
      sort: [{ 'dataHoraUltimaAtualizacao': 'desc' }],
      _source: ['numeroProcesso', 'classe', 'assuntos', 'dataHoraUltimaAtualizacao']
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `APIKey ${this.apiKey}` },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error: any = new Error(`DataJud API Error: ${response.statusText}`);
      error.status = response.status;
      throw error;
    }

    const raw = await response.json();
    const hits = raw?.hits?.hits || [];
    const codeSet = new Set(codes);

    return hits.map((hit: any) => {
      const s = hit._source || {};
      // pega o assunto do processo que casa com os códigos buscados
      const assunto = (s.assuntos || []).find((a: any) => codeSet.has(a?.codigo)) || (s.assuntos || [])[0] || {};
      const num = String(s.numeroProcesso || '');
      const numeroFormatado = num.length === 20
        ? `${num.slice(0,7)}-${num.slice(7,9)}.${num.slice(9,13)}.${num.slice(13,14)}.${num.slice(14,16)}.${num.slice(16,20)}`
        : num;
      return {
        numeroProcesso: numeroFormatado,
        classeNome: s.classe?.nome || 'Processo',
        assuntoCodigo: assunto.codigo != null ? String(assunto.codigo) : '',
        assuntoNome: assunto.nome || 'Assunto não informado',
        ultimaAtualizacao: s.dataHoraUltimaAtualizacao
      };
    });
  }
}
