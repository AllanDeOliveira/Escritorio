const logger = require('../infra/logger');
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const router = express.Router();
const prisma = require('../infra/prismaClient');

// Upload em memória só para a importação de planilha (não persiste arquivo em disco)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Cabeçalhos fixos do modelo de importação
const IMPORT_HEADERS = ['Título', 'Processo/Cliente', 'Responsável', 'Tipo', 'Prazo Limite', 'Prazo Interno', 'Observações'];

const PRAZO_TYPES = ['JUDICIAL', 'ADMINISTRATIVO', 'INTERNO'];
// A_CONFIRMAR: card que o robô criou sem data fatal (DJEN sem par no PJe, expediente
// "sem prazo"/pauta/ciência pendente). fatalDate guarda a publicação só como piso;
// vira PENDENTE quando alguém informa a data real (PUT) ou o PJe passa a mostrá-la.
const PRAZO_STATUS = ['PENDENTE', 'CUMPRIDO', 'CANCELADO', 'A_CONFIRMAR'];
const PRAZO_PRIORIDADES = ['ALTA', 'MEDIA', 'BAIXA'];

const includeRelations = {
    responsible: { select: { id: true, name: true, email: true } },
    // intimação de origem: tribunal e tipo de ato viram etiquetas no card do quadro
    intimacoes: { select: { tribunal: true, tipoDocumento: true, tipoComunicacao: true, nomeClasse: true, orgao: true }, take: 1 },
};

// Meia-noite de hoje, para comparar apenas por dia (não por hora)
function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function diffInDays(target, base) {
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const t = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    return Math.round((t.getTime() - base.getTime()) / MS_PER_DAY);
}

/**
 * Converte "YYYY-MM-DD" em Date de meia-noite LOCAL (não UTC). Um prazo marcado
 * para um dia deve significar aquele dia no fuso do usuário — senão, em fusos
 * atrás de UTC (ex: Brasil), "hoje" cairia no bucket "vencido" e a data exibida
 * voltaria um dia.
 */
function parseDateOnly(value) {
    if (!value) return undefined;
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(value);
}

// Data de formulário: só "AAAA-MM-DD" que existe de verdade (nada de 2026-02-30 "rolando"
// para março, nem número/timestamp virando 01/01/1970). O <input type=date> manda assim.
function dataValida(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = parseDateOnly(v);
    return d.getMonth() === Number(v.slice(5, 7)) - 1 && d.getDate() === Number(v.slice(8, 10));
}

/**
 * Parse tolerante de data vinda da planilha: aceita Date do Excel, "DD/MM/AAAA"
 * e "AAAA-MM-DD". Sempre retorna meia-noite LOCAL (mesma regra do parseDateOnly).
 */
function naFaixa(d) {
    if (!d || isNaN(d)) return null;
    const ano = d.getFullYear();
    // Ano fora desta faixa é erro de digitação na planilha, não prazo: a célula "2406"
    // (24/06 sem a barra) virava o ano 2406. Guard no resultado cobre os 4 formatos
    // aceitos e, por tabela, os 3 pontos de chamada da importação.
    // ponytail: faixa fixa; se um dia importarem histórico anterior a 2000, baixe o piso.
    return ano >= 2000 && ano <= new Date().getFullYear() + 10 ? d : null;
}

function parseImportDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return naFaixa(parseDateOnly(v.toISOString().slice(0, 10)));
    const s = String(v).trim();
    if (!s) return null;
    // DD/MM/AAAA ou DD.MM.AAAA — ano opcional (assume o ano corrente quando ausente);
    // ou a mesma data com ano de 4 dígitos dentro de um texto ("Prazo até 10/07/2030").
    // Texto livre NUNCA vai ao new Date(): o V8 lia "10/07/2030" como M/D/Y e gravava
    // 07/10/2030 sem avisar. O que não casa aqui é "sem data", não data errada.
    let m = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/) || s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    if (m) {
        const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear();
        const d = new Date(year, Number(m[2]) - 1, Number(m[1]));
        // 31/02 "rola" para março: dia e mês têm que bater com o digitado
        return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[1]) ? naFaixa(d) : null;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // AAAA-MM-DD
    if (m) return naFaixa(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return null;
}

/**
 * Detecta o formato "Publicações Processuais" do escritório: uma linha de
 * cabeçalho com PROCESSO + SITUAÇÃO + REQUERENTE/CLIENTE. Retorna o índice da
 * linha de cabeçalho e o mapa coluna→índice, ou null se não reconhecer.
 */
function detectOfficeHeader(grid) {
    for (let i = 0; i < Math.min(8, grid.length); i++) {
        const row = (grid[i] || []).map(c => String(c || '').trim().toUpperCase());
        const has = (re) => row.some(c => re.test(c));
        if (has(/PROCESSO/) && has(/SITUA/) && has(/REQUERENTE|CLIENTE/)) {
            const idx = {};
            row.forEach((c, j) => {
                if (/^DATA$/.test(c)) idx.data = j;
                else if (/PROCESSO/.test(c)) idx.processo = j;
                else if (/REQUERENTE|CLIENTE/.test(c)) idx.cliente = j;
                else if (/CIDADE/.test(c)) idx.cidade = j;
                else if (/VARA/.test(c)) idx.vara = j;
                else if (/^TIPO$/.test(c)) idx.tipo = j;
                else if (/^ADV/.test(c)) idx.adv = j;
                else if (/S[IÍ]NTESE/.test(c)) idx.sintese = j;
                else if (/SITUA/.test(c)) idx.situacao = j;
            });
            return { headerRow: i, idx };
        }
    }
    return null;
}

// Junta pedaços não-vazios num texto de observação ("Rótulo: valor · ...")
function joinObs(parts) {
    return parts.filter(p => p && p.value).map(p => `${p.label}: ${p.value}`).join(' · ') || null;
}

/**
 * Enriquece o prazo com campos derivados calculados na leitura:
 * - computedStatus: VENCIDO quando pendente e a data fatal já passou
 * - daysUntilFatal: dias corridos até o prazo fatal (negativo = atrasado)
 * - bucket: agrupamento para o painel (triagem | vencido | vencidoAntigo | hoje | semana | futuro | concluido)
 *   triagem = A_CONFIRMAR: ainda sem data fatal; daysUntilFatal negativo = dias parado
 *   vencidoAntigo = vencido há mais de VENCIDO_VISIVEL_DIAS: sai do quadro (decisão do
 *   escritório, 08/10/2026), mas o card continua no banco
 */
const VENCIDO_VISIVEL_DIAS = 2;
function enrich(prazo) {
    const today = startOfToday();
    const fatalDate = new Date(prazo.fatalDate);
    const days = diffInDays(fatalDate, today);

    let computedStatus = prazo.status;
    let bucket = 'futuro';

    if (prazo.status === 'CUMPRIDO' || prazo.status === 'CANCELADO') {
        bucket = 'concluido';
    } else if (prazo.status === 'A_CONFIRMAR') {
        bucket = 'triagem';
    } else if (days < 0) {
        computedStatus = 'VENCIDO';
        bucket = days >= -VENCIDO_VISIVEL_DIAS ? 'vencido' : 'vencidoAntigo';
    } else if (days === 0) {
        bucket = 'hoje';
    } else if (days <= 7) {
        bucket = 'semana';
    }

    return { ...prazo, computedStatus, daysUntilFatal: days, bucket };
}

function validateCreate(body) {
    const errors = [];
    if (typeof body.title !== 'string' || !body.title.trim()) errors.push('title é obrigatório');
    if (!dataValida(body.fatalDate)) errors.push('fatalDate é obrigatório e deve ser uma data válida (AAAA-MM-DD)');
    if (body.prioridade && !PRAZO_PRIORIDADES.includes(body.prioridade)) errors.push(`prioridade deve ser uma de: ${PRAZO_PRIORIDADES.join(', ')}`);
    if (body.internalDate && !dataValida(body.internalDate)) errors.push('internalDate inválida');
    if (body.type && !PRAZO_TYPES.includes(body.type)) errors.push(`type deve ser um de: ${PRAZO_TYPES.join(', ')}`);
    if (dataValida(body.fatalDate) && body.internalDate && dataValida(body.internalDate) && body.internalDate > body.fatalDate) {
        errors.push('internalDate não pode ser posterior a fatalDate'); // AAAA-MM-DD compara como string
    }
    return errors;
}

/**
 * Status de um card concluído que alguém reabriu (Desfazer / arrastar de volta). Card que nunca
 * teve data fatal — o fatalDate é só o piso: publicação no DJEN, ou expedição no PJe sem data
 * limite — volta para A_CONFIRMAR. Como PENDENTE, o piso no passado o jogava em vencidoAntigo
 * e ele sumia do quadro na hora. Data limite do PJe ou data posta à mão: PENDENTE.
 */
function statusAoReabrir(prazo, expedientes, intimacoes) {
    const dia = (d) => { if (!d) return NaN; const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const fatal = dia(prazo.fatalDate);
    if (expedientes.some((e) => dia(e.dataLimite) === fatal)) return 'PENDENTE';
    const piso = expedientes.some((e) => !e.dataLimite && dia(e.dataExpedicao || e.vistoEm) === fatal)
        || (!expedientes.length && intimacoes.some((i) => dia(i.dataDisponibilizacao) === fatal));
    return piso ? 'A_CONFIRMAR' : 'PENDENTE';
}

// Erros do Prisma que são culpa da entrada, não do servidor: viram 400 com motivo
function erroDeEntrada(error) {
    if (error.code === 'P2003') return 'Responsável, processo ou cliente informado não existe.';
    if (error.name === 'PrismaClientValidationError') return 'Dados em formato inválido.';
    return null;
}

// GET /api/prazos - lista com filtros
router.get('/', async (req, res) => {
    try {
        const { status, responsibleId, from, to, overdue } = req.query;
        // Parâmetro repetido (?a=1&a=2) vira array e derrubava o Prisma: só string vale
        const str = (v) => (typeof v === 'string' && v ? v : undefined);

        if (from && !dataValida(from)) {
            return res.status(400).json({ success: false, error: 'Parâmetro "from" inválido (AAAA-MM-DD)' });
        }
        if (to && !dataValida(to)) {
            return res.status(400).json({ success: false, error: 'Parâmetro "to" inválido (AAAA-MM-DD)' });
        }

        const where = {};
        const statusExplicito = typeof status === 'string' && PRAZO_STATUS.includes(status) ? status : null;
        // Cancelado sai do quadro ativo por padrão; ainda acessível via ?status=CANCELADO.
        if (statusExplicito) where.status = statusExplicito;
        else where.status = { not: 'CANCELADO' };
        if (str(responsibleId)) where.responsibleId = responsibleId;
        if (from || to) {
            // Prazos são meia-noite LOCAL (parseDateOnly); "to" inclui o dia inteiro
            const fimExclusivo = to ? new Date(parseDateOnly(to).getTime() + 24 * 60 * 60 * 1000) : null;
            where.fatalDate = {
                ...(from ? { gte: parseDateOnly(from) } : {}),
                ...(to ? { lt: fimExclusivo } : {}),
            };
        }
        if (overdue === 'true') {
            // Combina com filtros já definidos em vez de sobrescrevê-los:
            // só assume PENDENTE se o caller não pediu outro status explicitamente,
            // e soma o corte "vencido" ao invés de descartar from/to.
            where.status = statusExplicito || 'PENDENTE';
            where.fatalDate = { ...(where.fatalDate || {}), lt: startOfToday() };
        }

        const prazos = await prisma.prazo.findMany({
            where,
            include: includeRelations,
            orderBy: { fatalDate: 'asc' },
        });

        // Prazos criados pelo robô do PJe: tribunal/órgão/tipo do expediente (filtros do quadro) e onde estava no painel
        const expedientes = await prisma.expedientePje.findMany({
            where: { prazoId: { in: prazos.map((p) => p.id) } },
            select: { prazoId: true, tribunal: true, orgao: true, tipo: true, situacao: true, jurisdicao: true, caixa: true },
        });
        const origemPje = new Map(expedientes.map((e) => [e.prazoId, { tribunal: e.tribunal, orgao: e.orgao, tipo: e.tipo, situacao: e.situacao, jurisdicao: e.jurisdicao, caixa: e.caixa }]));
        res.json({ success: true, prazos: prazos.map((p) => ({ ...enrich(p), origemPje: origemPje.get(p.id) || null })) });
    } catch (error) {
        logger.error('[listPrazos] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao listar prazos.' });
    }
});

// GET /api/prazos/dashboard - painel agrupado por urgência
router.get('/dashboard', async (req, res) => {
    try {
        const pendentes = await prisma.prazo.findMany({
            where: { status: 'PENDENTE' },
            include: includeRelations,
            orderBy: { fatalDate: 'asc' },
        });

        const enriched = pendentes.map(enrich);
        const groups = {
            vencido: enriched.filter((p) => p.bucket === 'vencido'),
            hoje: enriched.filter((p) => p.bucket === 'hoje'),
            semana: enriched.filter((p) => p.bucket === 'semana'),
            futuro: enriched.filter((p) => p.bucket === 'futuro'),
        };

        res.json({
            success: true,
            counts: {
                vencido: groups.vencido.length,
                hoje: groups.hoje.length,
                semana: groups.semana.length,
                futuro: groups.futuro.length,
                alerta: groups.vencido.length + groups.hoje.length,
            },
            groups,
        });
    } catch (error) {
        logger.error('[getPrazosDashboard] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao carregar painel de prazos.' });
    }
});

// GET /api/prazos/template - baixa a planilha-modelo (.xlsx) de importação
router.get('/template', (req, res) => {
    try {
        const exemplo = {
            'Título': 'Contestação',
            'Processo/Cliente': 'Silva vs Banco X',
            'Responsável': 'Dr. Ana',
            'Tipo': 'JUDICIAL',
            'Prazo Limite': '10/07/2026',
            'Prazo Interno': '07/07/2026',
            'Observações': 'Processo nº 0000000-00.0000.0.00.0000',
        };
        const ws = XLSX.utils.json_to_sheet([exemplo], { header: IMPORT_HEADERS });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Prazos');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="modelo-prazos.xlsx"');
        res.send(buf);
    } catch (error) {
        logger.error('[prazosTemplate] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao gerar o modelo.' });
    }
});

// POST /api/prazos/import - importa prazos de uma planilha (.xlsx/.csv)
router.post('/import', upload.single('planilha'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
        }

        // CSV UTF-8 sem BOM (Google Sheets, LibreOffice) era lido como Latin-1: "Título" virava
        // "TÃ­tulo" e nenhuma coluna casava. Só força UTF-8 quando o arquivo é UTF-8 válido —
        // o CSV ANSI do Excel continua sendo lido como antes.
        let codepage;
        try { new TextDecoder('utf-8', { fatal: true }).decode(req.file.buffer); codepage = 65001; } catch { /* ANSI ou binário */ }
        let wb;
        try {
            // raw: true só vale para CSV/TXT — mantém "10/07/2030" como TEXTO. Sem isso a
            // biblioteca o convertia em data no padrão americano (7 de outubro) antes do
            // nosso parser dd/mm ver a célula. Datas reais de .xlsx continuam vindo como Date.
            wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true, codepage, raw: true });
        } catch {
            return res.status(400).json({ success: false, error: 'Não foi possível ler o arquivo. Envie uma planilha .xlsx ou .csv.' });
        }
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) return res.status(400).json({ success: false, error: 'A planilha está vazia.' });
        const createdById = req.currentUser?.id || undefined;

        // Monta a lista de registros conforme o formato detectado.
        const records = [];
        let ignoredNoDate = 0; // linhas sem data de prazo (só no formato do escritório)

        const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, cellDates: true, blankrows: false });
        const office = detectOfficeHeader(grid);

        if (office) {
            // ── Formato "Publicações Processuais" do escritório ──────────────
            const { headerRow, idx } = office;
            for (let i = headerRow + 1; i < grid.length; i++) {
                const row = grid[i] || [];
                const cell = (k) => idx[k] !== undefined ? String(row[idx[k]] || '').trim() : '';
                const cliente = cell('cliente');
                const situacao = cell('situacao');
                // pula cabeçalhos repetidos e linhas vazias
                if (!cliente && !cell('processo')) continue;
                if (cliente.toUpperCase() === 'REQUERENTE CLIENTE' || situacao.toUpperCase() === 'SITUAÇÃO') continue;

                const fatalDate = parseImportDate(situacao);
                if (!fatalDate) { ignoredNoDate++; continue; } // sem data na SITUAÇÃO → ignora

                records.push({
                    title: cliente || cell('processo'),
                    caseReference: cell('processo') || null,
                    responsibleName: cell('adv').replace(/[[\]]/g, '') || null,
                    type: 'JUDICIAL',
                    fatalDate,
                    description: joinObs([
                        { label: 'Síntese', value: cell('sintese') },
                        { label: 'Tipo', value: cell('tipo') },
                        { label: 'Cidade', value: cell('cidade') },
                        { label: 'Vara', value: cell('vara') },
                        { label: 'Publicação', value: cell('data') },
                    ]),
                });
            }
        } else {
            // ── Formato do modelo padrão (cabeçalhos fixos) ──────────────────
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            // Cabeçalho sem acento ("Titulo", "Responsavel") também vale
            const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
            const colunas = Object.keys(rows[0] || {});
            const col = (...nomes) => colunas.find((c) => nomes.includes(semAcento(c)));
            const cTitulo = col('titulo');
            const cFatal = col('prazo limite', 'data fatal'); // planilhas antigas usam "Data Fatal"
            if (!cTitulo || !cFatal) {
                return res.status(400).json({ success: false, error: 'Formato não reconhecido: a planilha precisa das colunas "Título" e "Prazo Limite" (baixe o modelo) ou do cabeçalho "Publicações Processuais".' });
            }
            const cCaso = col('processo/cliente'); const cResp = col('responsavel'); const cTipo = col('tipo');
            const cInterno = col('prazo interno'); const cObs = col('observacoes');
            const txt = (row, c) => (c ? String(row[c] || '').trim() : '');
            for (const row of rows) {
                const title = txt(row, cTitulo);
                const fatalDate = parseImportDate(row[cFatal]);
                if (!title || !fatalDate) { ignoredNoDate++; continue; }
                const typeRaw = txt(row, cTipo).toUpperCase();
                records.push({
                    title,
                    caseReference: txt(row, cCaso) || null,
                    responsibleName: txt(row, cResp) || null,
                    type: PRAZO_TYPES.includes(typeRaw) ? typeRaw : 'JUDICIAL',
                    fatalDate,
                    internalDate: (cInterno && parseImportDate(row[cInterno])) || undefined,
                    description: txt(row, cObs) || null,
                });
            }
        }

        let imported = 0;
        const errors = [];
        for (const rec of records) {
            try {
                await prisma.prazo.create({ data: { ...rec, createdById, source: 'PLANILHA' } });
                imported++;
            } catch (e) {
                errors.push({ titulo: rec.title, erro: 'Falha ao gravar' });
            }
        }

        res.json({ success: true, imported, ignoredNoDate, format: office ? 'escritorio' : 'modelo', errors });
    } catch (error) {
        logger.error('[prazosImport] Erro:', error);
        res.status(500).json({ success: false, error: 'Não foi possível ler a planilha. Confira se está no formato do modelo.' });
    }
});

// POST /api/prazos - cria prazo
router.post('/', async (req, res) => {
    try {
        const errors = validateCreate(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: 'Dados inválidos', details: errors });
        }

        const { title, description, type, prioridade, fatalDate, internalDate, responsibleName, caseReference, responsibleId } = req.body;
        const createdById = req.currentUser?.id; // autor é quem está logado, nunca o corpo

        const prazo = await prisma.prazo.create({
            data: {
                title: title.trim(),
                description,
                type: type || 'JUDICIAL',
                prioridade: prioridade || null,
                fatalDate: parseDateOnly(fatalDate),
                internalDate: internalDate ? parseDateOnly(internalDate) : undefined,
                responsibleName,
                caseReference,
                responsibleId,
                createdById,
            },
            include: includeRelations,
        });

        res.status(201).json({ success: true, prazo: enrich(prazo) });
    } catch (error) {
        const motivo = erroDeEntrada(error);
        if (motivo) return res.status(400).json({ success: false, error: motivo });
        logger.error('[createPrazo] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao criar prazo.' });
    }
});

// PUT /api/prazos/:id - edita prazo
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = {};
        const body = req.body;

        const errors = [];
        if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) errors.push('title não pode ficar vazio');
        if (body.status !== undefined && !PRAZO_STATUS.includes(body.status)) errors.push(`status deve ser um de: ${PRAZO_STATUS.join(', ')}`);
        if (body.type !== undefined && !PRAZO_TYPES.includes(body.type)) errors.push(`type deve ser um de: ${PRAZO_TYPES.join(', ')}`);
        if (body.prioridade && !PRAZO_PRIORIDADES.includes(body.prioridade)) errors.push(`prioridade deve ser uma de: ${PRAZO_PRIORIDADES.join(', ')}`);
        if (body.fatalDate !== undefined && !dataValida(body.fatalDate)) errors.push('fatalDate inválida (AAAA-MM-DD)');
        if (body.internalDate && !dataValida(body.internalDate)) errors.push('internalDate inválida (AAAA-MM-DD)');
        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: 'Dados inválidos', details: errors });
        }
        // Interno depois do fatal: cruza o valor novo com o que já está gravado (o POST já cruzava)
        if (body.fatalDate !== undefined || body.internalDate) {
            const atual = await prisma.prazo.findUnique({ where: { id }, select: { fatalDate: true, internalDate: true, status: true } });
            if (!atual) return res.status(404).json({ success: false, error: 'Prazo não encontrado.' });
            const fatal = body.fatalDate !== undefined ? parseDateOnly(body.fatalDate) : atual.fatalDate;
            const interno = body.internalDate ? parseDateOnly(body.internalDate) : (body.internalDate === undefined ? atual.internalDate : null);
            if (interno && fatal && interno > fatal) {
                return res.status(400).json({ success: false, error: 'Dados inválidos', details: ['internalDate não pode ser posterior a fatalDate'] });
            }
            // Card "a confirmar" ganhou data de verdade → entra no quadro. Só quando a data
            // MUDOU: o modal reenvia a data-piso ao salvar título, e isso não é confirmação.
            if (atual.status === 'A_CONFIRMAR' && body.status === undefined && fatal.getTime() !== atual.fatalDate.getTime()) {
                data.status = 'PENDENTE';
            }
        }

        if (body.title !== undefined) data.title = body.title.trim();
        if (body.description !== undefined) data.description = body.description;
        if (body.type !== undefined) data.type = body.type;
        if (body.prioridade !== undefined) data.prioridade = body.prioridade || null;
        if (body.status !== undefined) {
            data.status = body.status;
            // Mantém completedAt consistente com o status também fora do atalho /cumprir
            data.completedAt = body.status === 'CUMPRIDO' ? new Date() : null;
        }
        if (body.fatalDate !== undefined) data.fatalDate = parseDateOnly(body.fatalDate);
        if (body.internalDate !== undefined) data.internalDate = body.internalDate ? parseDateOnly(body.internalDate) : null;
        if (body.responsibleName !== undefined) data.responsibleName = body.responsibleName;
        if (body.caseReference !== undefined) data.caseReference = body.caseReference;
        if (body.responsibleId !== undefined) data.responsibleId = body.responsibleId;
        // Auditoria de movimentação: o cliente só sinaliza que foi um arraste
        // (lastMovedBy preenchido); quem moveu é sempre o usuário autenticado.
        if (body.lastMovedBy !== undefined && body.lastMovedBy !== null && String(body.lastMovedBy).trim() !== '') {
            data.lastMovedBy = req.currentUser?.name || req.currentUser?.email || String(body.lastMovedBy).trim();
            data.lastMovedAt = new Date();
        }
        // Reabertura sem data nova: o card sem data fatal volta para "a confirmar" (statusAoReabrir)
        if (data.status === 'PENDENTE' && body.fatalDate === undefined) {
            const atual = await prisma.prazo.findUnique({
                where: { id }, select: { status: true, fatalDate: true, intimacoes: { select: { dataDisponibilizacao: true } } },
            });
            if (atual && (atual.status === 'CUMPRIDO' || atual.status === 'CANCELADO')) {
                const expedientes = await prisma.expedientePje.findMany({ where: { prazoId: id }, select: { dataLimite: true, dataExpedicao: true, vistoEm: true } });
                data.status = statusAoReabrir(atual, expedientes, atual.intimacoes);
            }
        }

        const prazo = await prisma.prazo.update({
            where: { id },
            data,
            include: includeRelations,
        });

        res.json({ success: true, prazo: enrich(prazo) });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, error: 'Prazo não encontrado.' });
        }
        const motivo = erroDeEntrada(error);
        if (motivo) return res.status(400).json({ success: false, error: motivo });
        logger.error('[updatePrazo] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar prazo.' });
    }
});

// PATCH /api/prazos/:id/cumprir - marca como cumprido
router.patch('/:id/cumprir', async (req, res) => {
    try {
        const { id } = req.params;
        const prazo = await prisma.prazo.update({
            where: { id },
            data: { status: 'CUMPRIDO', completedAt: new Date() },
            include: includeRelations,
        });

        res.json({ success: true, prazo: enrich(prazo) });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, error: 'Prazo não encontrado.' });
        }
        logger.error('[cumprirPrazo] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao marcar prazo como cumprido.' });
    }
});

// PATCH /api/prazos/:id/pegar — assume o card E todos os cards abertos sem dono do
// mesmo processo: quem pega um ato pega o processo (os próximos cards do robô já
// nascem no nome dessa pessoa, ver pjePainel.donoDoProcesso). Card já no nome de
// alguém (id ou nome livre) não é roubado; se outra pessoa pegou antes, 409.
router.patch('/:id/pegar', async (req, res) => {
    try {
        const { id } = req.params;
        const u = req.currentUser;
        const p = await prisma.prazo.findUnique({ where: { id }, select: { caseReference: true } });
        if (!p) return res.status(404).json({ success: false, error: 'Prazo não encontrado.' });
        const r = await prisma.prazo.updateMany({
            where: {
                status: { in: ['PENDENTE', 'A_CONFIRMAR'] },
                AND: [
                    { OR: [{ id }, ...(p.caseReference ? [{ caseReference: p.caseReference }] : [])] },
                    { responsibleId: null, OR: [{ responsibleName: null }, { responsibleName: '' }] },
                ],
            },
            data: { responsibleId: u.id, responsibleName: u.name || u.email },
        });
        if (r.count === 0) return res.status(409).json({ success: false, error: 'Este card já está no nome de alguém.' });
        res.json({ success: true, assumidos: r.count, processo: p.caseReference });
    } catch (error) {
        logger.error('[pegarPrazo] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao assumir o prazo.' });
    }
});

// DELETE /api/prazos/:id - remove prazo
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.prazo.delete({ where: { id } });
        res.status(204).send();
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, error: 'Prazo não encontrado.' });
        }
        logger.error('[deletePrazo] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao excluir prazo.' });
    }
});

module.exports = router;
module.exports.parseImportDate = parseImportDate; // exposto para teste
module.exports.enrich = enrich; // exposto para teste
module.exports.statusAoReabrir = statusAoReabrir; // exposto para teste
