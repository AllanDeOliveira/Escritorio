const logger = require('../infra/logger');
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const router = express.Router();
const prisma = require('../infra/prismaClient');

// Upload em memória só para a importação de planilha (não persiste arquivo em disco)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Cabeçalhos fixos do modelo de importação
const IMPORT_HEADERS = ['Título', 'Processo/Cliente', 'Responsável', 'Tipo', 'Data Fatal', 'Prazo Interno', 'Observações'];

const PRAZO_TYPES = ['JUDICIAL', 'ADMINISTRATIVO', 'INTERNO'];
const PRAZO_STATUS = ['PENDENTE', 'CUMPRIDO', 'CANCELADO'];

const includeRelations = {
    responsible: { select: { id: true, name: true, email: true } },
    lawsuit: { select: { id: true, caseNumber: true, actionType: true } },
    client: { select: { id: true, name: true } },
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

/**
 * Parse tolerante de data vinda da planilha: aceita Date do Excel, "DD/MM/AAAA"
 * e "AAAA-MM-DD". Sempre retorna meia-noite LOCAL (mesma regra do parseDateOnly).
 */
function parseImportDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return parseDateOnly(v.toISOString().slice(0, 10));
    const s = String(v).trim();
    if (!s) return null;
    // DD/MM/AAAA ou DD.MM.AAAA — ano opcional (assume o ano corrente quando ausente)
    let m = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/);
    if (m) {
        const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear();
        return new Date(year, Number(m[2]) - 1, Number(m[1]));
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // AAAA-MM-DD
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(s);
    return isNaN(d) ? null : d;
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
 * - bucket: agrupamento para o painel (vencido | hoje | semana | futuro | concluido)
 */
function enrich(prazo) {
    const today = startOfToday();
    const fatalDate = new Date(prazo.fatalDate);
    const days = diffInDays(fatalDate, today);

    let computedStatus = prazo.status;
    let bucket = 'futuro';

    if (prazo.status === 'CUMPRIDO' || prazo.status === 'CANCELADO') {
        bucket = 'concluido';
    } else if (days < 0) {
        computedStatus = 'VENCIDO';
        bucket = 'vencido';
    } else if (days === 0) {
        bucket = 'hoje';
    } else if (days <= 7) {
        bucket = 'semana';
    }

    return { ...prazo, computedStatus, daysUntilFatal: days, bucket };
}

function validateCreate(body) {
    const errors = [];
    if (!body.title || typeof body.title !== 'string') errors.push('title é obrigatório');
    if (!body.fatalDate || isNaN(Date.parse(body.fatalDate))) errors.push('fatalDate é obrigatório e deve ser uma data válida');
    if (body.internalDate && isNaN(Date.parse(body.internalDate))) errors.push('internalDate inválida');
    if (body.type && !PRAZO_TYPES.includes(body.type)) errors.push(`type deve ser um de: ${PRAZO_TYPES.join(', ')}`);
    if (body.fatalDate && body.internalDate && !isNaN(Date.parse(body.internalDate)) && !isNaN(Date.parse(body.fatalDate))) {
        if (new Date(body.internalDate) > new Date(body.fatalDate)) {
            errors.push('internalDate não pode ser posterior a fatalDate');
        }
    }
    return errors;
}

// GET /api/prazos - lista com filtros
router.get('/', async (req, res) => {
    try {
        const { status, responsibleId, lawsuitId, clientId, from, to, overdue } = req.query;

        if (from && isNaN(Date.parse(from))) {
            return res.status(400).json({ success: false, error: 'Parâmetro "from" inválido' });
        }
        if (to && isNaN(Date.parse(to))) {
            return res.status(400).json({ success: false, error: 'Parâmetro "to" inválido' });
        }

        const where = {};
        if (status && PRAZO_STATUS.includes(status)) where.status = status;
        if (responsibleId) where.responsibleId = responsibleId;
        if (lawsuitId) where.lawsuitId = lawsuitId;
        if (clientId) where.clientId = clientId;
        if (from || to) {
            where.fatalDate = {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
            };
        }
        if (overdue === 'true') {
            // Combina com filtros já definidos em vez de sobrescrevê-los:
            // só assume PENDENTE se o caller não pediu outro status explicitamente,
            // e soma o corte "vencido" ao invés de descartar from/to.
            where.status = where.status || 'PENDENTE';
            where.fatalDate = { ...(where.fatalDate || {}), lt: startOfToday() };
        }

        const prazos = await prisma.prazo.findMany({
            where,
            include: includeRelations,
            orderBy: { fatalDate: 'asc' },
        });

        res.json({ success: true, prazos: prazos.map(enrich) });
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
            'Data Fatal': '10/07/2026',
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

        const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
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
            for (const row of rows) {
                const title = String(row['Título'] || '').trim();
                const fatalDate = parseImportDate(row['Data Fatal']);
                if (!title || !fatalDate) { ignoredNoDate++; continue; }
                const typeRaw = String(row['Tipo'] || '').trim().toUpperCase();
                records.push({
                    title,
                    caseReference: String(row['Processo/Cliente'] || '').trim() || null,
                    responsibleName: String(row['Responsável'] || '').trim() || null,
                    type: PRAZO_TYPES.includes(typeRaw) ? typeRaw : 'JUDICIAL',
                    fatalDate,
                    internalDate: parseImportDate(row['Prazo Interno']) || undefined,
                    description: String(row['Observações'] || '').trim() || null,
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

        const { title, description, type, fatalDate, internalDate, responsibleName, caseReference, responsibleId, lawsuitId, clientId, createdById } = req.body;

        const prazo = await prisma.prazo.create({
            data: {
                title,
                description,
                type: type || 'JUDICIAL',
                fatalDate: parseDateOnly(fatalDate),
                internalDate: internalDate ? parseDateOnly(internalDate) : undefined,
                responsibleName,
                caseReference,
                responsibleId,
                lawsuitId,
                clientId,
                createdById,
            },
            include: includeRelations,
        });

        res.status(201).json({ success: true, prazo: enrich(prazo) });
    } catch (error) {
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
        if (body.status !== undefined && !PRAZO_STATUS.includes(body.status)) errors.push(`status deve ser um de: ${PRAZO_STATUS.join(', ')}`);
        if (body.type !== undefined && !PRAZO_TYPES.includes(body.type)) errors.push(`type deve ser um de: ${PRAZO_TYPES.join(', ')}`);
        if (body.fatalDate !== undefined && isNaN(Date.parse(body.fatalDate))) errors.push('fatalDate inválida');
        if (body.internalDate && isNaN(Date.parse(body.internalDate))) errors.push('internalDate inválida');
        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: 'Dados inválidos', details: errors });
        }

        if (body.title !== undefined) data.title = body.title;
        if (body.description !== undefined) data.description = body.description;
        if (body.type !== undefined) data.type = body.type;
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
        // Auditoria de movimentação: quando o cliente informa quem moveu, grava
        // o nome e o momento. Usado ao arrastar o card entre colunas.
        if (body.lastMovedBy !== undefined && body.lastMovedBy !== null && String(body.lastMovedBy).trim() !== '') {
            data.lastMovedBy = String(body.lastMovedBy).trim();
            data.lastMovedAt = new Date();
        }
        if (body.lawsuitId !== undefined) data.lawsuitId = body.lawsuitId;
        if (body.clientId !== undefined) data.clientId = body.clientId;

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
