const logger = require('../infra/logger');
const https = require('https');

const API_KEY = process.env.DATAJUD_API_KEY;

const formatCNJ = (number) => {
    const clean = number.replace(/\D/g, '');
    if (clean.length !== 20) return number;
    return `${clean.slice(0, 7)}-${clean.slice(7, 9)}.${clean.slice(9, 13)}.${clean.slice(13, 14)}.${clean.slice(14, 16)}.${clean.slice(16, 20)}`;
};

const getSiglaTribunal = (numberStr) => {
    // Ex: 101239705 2025 8 11 0006
    // idx:        13   14 15
    const j = numberStr.substring(13, 14);
    const tr = numberStr.substring(14, 16);
    
    if (j === '8') {
        // Justiça Estadual
        const mapEstados = {
            '01':'ac', '02':'al', '03':'ap', '04':'am', '05':'ba', '06':'ce', '07':'df', '08':'es', '09':'go', '10':'ma',
            '11':'mt', '12':'ms', '13':'mg', '14':'pa', '15':'pb', '16':'pr', '17':'pe', '18':'pi', '19':'rj', '20':'rn',
            '21':'rs', '22':'ro', '23':'rr', '24':'sc', '25':'sp', '26':'se', '27':'to'
        };
        return `tj${mapEstados[tr] || 'sp'}`;
    } else if (j === '4') {
        // Federal
        return `trf${parseInt(tr)}`;
    } else if (j === '5') {
        // Trabalho
        return `trt${parseInt(tr)}`;
    }
    return 'tjsp'; // Fallback
};

const getProcessoDatajud = async (cnj) => {
    const cleanCnj = cnj.replace(/\D/g, '');
    if (cleanCnj.length !== 20) {
        throw new Error('Número de processo CNJ inválido. Digite os 20 números.');
    }

    const data = JSON.stringify({
        query: { match: { numeroProcesso: cleanCnj } }
    });

    const siglaTribunal = getSiglaTribunal(cleanCnj);
    const endpoint = `https://api-publica.datajud.cnj.jus.br/api_publica_${siglaTribunal}/_search`;

    logger.info(`[Datajud] Consultando ${cleanCnj} em ${endpoint}...`);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `APIKey ${API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Origin': 'https://datajud-wiki.cnj.jus.br',
                'Referer': 'https://datajud-wiki.cnj.jus.br/'
            },
            body: data,
            signal: AbortSignal.timeout(30000) // Aumentado para 30 segundos
        });

        logger.info(`[Datajud] Status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`[Datajud] Erro: ${errorText}`);
            throw new Error(`O Tribunal ${siglaTribunal.toUpperCase()} (Datajud) recusou a conexão. Status: ${response.status}`);
        }

        const parsed = await response.json();
        const hits = parsed.hits?.hits || [];

        if (hits.length === 0) {
            logger.info(`[Datajud] Nenhum resultado para ${cleanCnj}`);
            throw new Error('Processo não encontrado. Se for muito recente ou estiver sob segredo, ele não aparece na API pública.');
        }

        const processo = hits[0]._source;
        logger.info(`[Datajud] Sucesso. Tribunal: ${processo.siglaTribunal}`);
        
        let movs = processo.movimentos || [];
        const movimentos = movs.map(m => {
            let objData = new Date(m.dataHora);
            let desc = m.complementosTabelados?.map(c => `${c.nome}: ${c.valor}`).join(' | ');
            if (!desc && m.descricao) desc = m.descricao;
            return {
                data: isNaN(objData.getTime()) ? m.dataHora : objData.toLocaleDateString('pt-BR'),
                evento: m.nome || "Andamento",
                descricao: desc || "Movimentação registrada no tribunal."
            }
        }).sort((a,b) => {
            return new Date(b.data.split('/').reverse().join('-')) - new Date(a.data.split('/').reverse().join('-'));
        });

        let assuntoNome = "Não informado";
        if (processo.assuntos && processo.assuntos.length > 0) {
            assuntoNome = processo.assuntos[0].nome;
        }

        const formatCurrency = (val) => val ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val) : "Não informado";

        return {
            numero: formatCNJ(processo.numeroProcesso),
            tribunal: processo.siglaTribunal || siglaTribunal.toUpperCase(),
            juizo: processo.orgaoJulgador?.nomeOrgao || "Órgão não especificado",
            classe: processo.classe?.nome || "Não informada",
            assunto: assuntoNome,
            status: "ATIVO",
            valorCausa: formatCurrency(processo.valorCausa),
            dataDistribuicao: processo.dataAjuizamento ? new Date(processo.dataAjuizamento).toLocaleDateString('pt-BR') : "Desconhecida",
            partes: [], 
            movimentacoes: movimentos
        };

    } catch (e) {
        logger.error(`[Datajud] Falha Crítica: ${e.message}`);
        if (e.name === 'TimeoutError') {
            throw new Error(`O Tribunal (${siglaTribunal.toUpperCase()}) está lento demais e não respondeu em 30s. Tente novamente em instantes.`);
        }
        throw new Error(`Erro na conexão com o Tribunal: ${e.message}`);
    }
};

module.exports = {
    getProcesso: getProcessoDatajud,
    formatCNJ
};
