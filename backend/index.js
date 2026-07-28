// .env é carregado via --env-file-if-exists=.env nos scripts do package.json
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { getGenAI } = require('./src/infra/genai');
const { lerConfig, salvarConfig } = require('./src/config/escritorioConfig');
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');
// ponytail: geração DOCX exige templates/modelo_base.docx (Docxtemplater);
// o builder-fallback sem template foi removido — restaurar do git se precisar
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const prisma = require('./src/infra/prismaClient');
const logger = require('./src/infra/logger');

// Auth imports
const userRoutes = require('./src/routes/userRoutes');
const { requireAdmin } = require('./src/middleware/requireAdmin');
const { requireUser } = require('./src/middleware/requireUser');
const { SYSTEM_PROMPT } = require('./prompts');

// WhatsApp Automation Imports
const cron = require('node-cron');
const whatsappRoutes = require('./src/routes/whatsappRoutes');
const { initializeWhatsApp } = require('./src/services/whatsappService');
const { runDailyNotifications, notifyPetitionGenerated } = require('./src/services/notificationService');
const { syncIntimacoesSafe } = require('./src/services/djenService');

const app = express();
const allowedOrigins = process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL]
    : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Auth routes
app.use('/api/users', userRoutes);
app.use('/api/admin', requireAdmin);



// ── Pastas e config ─────────────────────────────────────────────────────────
const MODELOS_DIR = path.join(__dirname, 'modelos');
if (!fs.existsSync(MODELOS_DIR)) fs.mkdirSync(MODELOS_DIR);

const TEMPLATES_DIR = path.join(__dirname, 'templates');
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR);

const CONFIG_DIR = path.join(__dirname, 'config');
if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR);
const CONFIG_FILE = path.join(CONFIG_DIR, 'escritorio.json');

// ── Multer ───────────────────────────────────────────────────────────────────
const uploadTemp = multer({
    dest: 'uploads/',
    limits: { fileSize: 200 * 1024 * 1024 }
});
const uploadModelo = multer({
    dest: MODELOS_DIR,
    limits: { fileSize: 200 * 1024 * 1024 }
});

// ── Google GenAI ─────────────────────────────────────────────────────────────
const ai = getGenAI();

// ── Helper: aguardar arquivo ficar ACTIVE na File API ────────────────────────
async function waitForFileActive(fileName, maxWaitMs = 120000) {
    const pollIntervalMs = 3000;
    const startTime = Date.now();
    logger.info(`[Gemini Upload] Aguardando arquivo ficar ACTIVE: ${fileName}...`);
    while (Date.now() - startTime < maxWaitMs) {
        const fileInfo = await ai.files.get({ name: fileName });
        const state = fileInfo.state;
        if (state === 'ACTIVE') {
            logger.info(`[Gemini Upload] Arquivo ACTIVE após ${Math.round((Date.now() - startTime) / 1000)}s.`);
            return fileInfo;
        }
        if (state === 'FAILED') {
            throw new Error(`Arquivo ${fileName} falhou no processamento pelo Google (state: FAILED).`);
        }
        logger.info(`[Gemini Upload] Estado atual: ${state}. Aguardando ${pollIntervalMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`Timeout: arquivo ${fileName} não ficou ACTIVE em ${maxWaitMs / 1000}s.`);
}

// ── Helper: extrair texto/base64 de um arquivo ───────────────────────────────
async function prepararConteudo(filePath, mimeType) {
    try {
        if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
            // Upload direto para a File API usando a instância do ai (suporta até 2GB por arquivo e faz OCR nativo)
            const uploadResponse = await ai.files.upload({
                file: filePath,
                config: { mimeType: mimeType },
            });
            return {
                fileData: {
                    mimeType: mimeType,
                    fileUri: uploadResponse.uri,
                },
            };
        } else if (mimeType.includes('wordprocessingml.document') || filePath.endsWith('.docx')) {
            const result = await mammoth.extractRawText({ path: filePath });
            return { text: `\nDOCUMENTO ANEXADO:\n${result.value}\n` };
        } else if (mimeType.startsWith('text/') || filePath.endsWith('.txt')) {
            const text = fs.readFileSync(filePath, 'utf8');
            return { text: `\nDOCUMENTO ANEXADO:\n${text}\n` };
        }
    } catch (err) {
        logger.error(`Erro ao processar arquivo ${filePath}:`, err);
    }
    return null;
}


// ═══════════════════════════════════════════════════════════════════════════
// STATUS DO SISTEMA E DIAGNÓSTICO
// ═══════════════════════════════════════════════════════════════════════════

// Sem requireUser propositalmente: é consumida via <iframe src="...">/download
// direto no navegador, que não consegue anexar o header x-user-email.
app.get('/api/modelos/view/:nome', (req, res) => {
    try {
        const nome = req.params.nome;
        const filePath = path.join(MODELOS_DIR, nome);

        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            const decodedNome = decodeURIComponent(nome);
            const decodedPath = path.join(MODELOS_DIR, decodedNome);
            if (fs.existsSync(decodedPath)) {
                return res.sendFile(decodedPath);
            }
            res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Nova rota para preview HTML (mammoth) com suporte a nomes complexos
app.get('/api/modelos/preview/:nome', requireUser, async (req, res) => {
    try {
        let nome = req.params.nome;
        if (!nome) return res.status(400).json({ success: false, error: 'Nome não fornecido' });

        // Tenta encontrar o arquivo com o nome original, decodificado ou corrigido
        const tentativas = [
            nome,
            decodeURIComponent(nome),
            // Fix double encoding (CÃ³pia -> Cópia)
            (() => { try { return Buffer.from(nome, 'latin1').toString('utf8'); } catch (e) { return nome; } })(),
            (() => { try { return Buffer.from(decodeURIComponent(nome), 'latin1').toString('utf8'); } catch (e) { return nome; } })()
        ];

        let filePath = null;
        for (const t of tentativas) {
            const p = path.join(MODELOS_DIR, t);
            if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                filePath = p;
                break;
            }
        }

        if (!filePath) {
            return res.status(404).json({ success: false, error: 'Arquivo não encontrado após várias tentativas.' });
        }

        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.docx') {
            const result = await mammoth.convertToHtml({ path: filePath });
            res.json({ success: true, html: result.value, type: 'docx' });
        } else if (ext === '.pdf') {
            res.json({ success: true, url: `/api/modelos/view/${encodeURIComponent(path.basename(filePath))}`, type: 'pdf' });
        } else {
            const text = fs.readFileSync(filePath, 'utf8');
            res.json({ success: true, html: `<pre>${text}</pre>`, type: 'text' });
        }
    } catch (err) {
        logger.error('Erro no preview:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/status', async (req, res) => {
    try {
        const status = {
            online: true,
            gemini: 'checking',
            storage: 'ok',
            config: 'ok',
            timestamp: new Date().toISOString()
        };

        // Verificação Gemini
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes('your_gemini_api_key')) {
            status.gemini = 'placeholder_key';
            status.online = false;
        } else {
            // Removido o teste automático para evitar mensagens de "Instável"
            status.gemini = 'online';
        }

        // Verificação Storage
        try {
            fs.accessSync(MODELOS_DIR, fs.constants.W_OK);
            fs.accessSync(path.join(__dirname, 'uploads'), fs.constants.W_OK);
        } catch (e) {
            status.storage = 'read_only_or_missing';
            status.online = false;
        }

        res.json(status);
    } catch (err) {
        res.status(500).json({ online: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROTAS — CONFIGURAÇÕES DO ESCRITÓRIO
// ═══════════════════════════════════════════════════════════════════════════

// Sem requireUser propositalmente: chamada antes do login (tela de login
// mostra o nome do sistema). Só expõe dados de marca do escritório, não sensíveis.
app.get('/api/config', (req, res) => {
    res.json({ success: true, config: lerConfig() });
});

// Salvar configurações
app.post('/api/config', requireAdmin, (req, res) => {
    try {
        const nova = { ...CONFIG_DEFAULT, ...req.body };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(nova, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Extrair dados do escritorio automaticamente dos modelos cadastrados
app.post('/api/config/extrair-modelos', requireAdmin, async (req, res) => {
    try {
        const arquivos = fs.readdirSync(MODELOS_DIR);
        if (arquivos.length === 0) {
            return res.status(400).json({ success: false, error: 'Nenhum modelo cadastrado. Adicione modelos primeiro na aba Modelos.' });
        }

        const contents = [];
        contents.push('Analise os documentos a seguir que sao pecas juridicas reais de um escritorio de advocacia. Extraia com precisao as informacoes abaixo e responda APENAS com um JSON valido, sem markdown, sem explicacoes:\n{"nomeEscritorio":"","subtitulo":"","nomeAdvogado":"","oab":"","endereco":"","cidade":"","estado":"","cep":"","telefone":"","email":""}\nSe algum campo nao estiver nos documentos deixe como string vazia. NAO invente dados.');

        for (const nome of arquivos) {
            const filePath = path.join(MODELOS_DIR, nome);
            const ext = (nome.split('.').pop() || '').toLowerCase();
            const mimeType =
                ext === 'pdf' ? 'application/pdf' :
                    ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                        ext === 'txt' ? 'text/plain' :
                            (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' :
                                ext === 'png' ? 'image/png' : 'text/plain';
            try {
                const conteudo = await prepararConteudo(filePath, mimeType);
                if (conteudo) {
                    if (typeof conteudo === 'string') {
                        contents.push('--- MODELO: ' + nome + ' ---\n' + conteudo);
                    } else {
                        contents.push('--- MODELO: ' + nome + ' ---');
                        contents.push(conteudo);
                    }
                }
            } catch (e) {
                logger.warn('Nao foi possivel ler o modelo ' + nome + ':', e.message);
            }
        }

        const response = await ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
            contents: [{ role: 'user', parts: contents.map(c => typeof c === 'string' ? { text: c } : c) }],
            config: { temperature: 0.1 },
        });
        logUsage(response.usageMetadata?.totalTokenCount || 0);

        let rawText = response.text.trim();
        rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

        let dadosExtraidos;
        try {
            dadosExtraidos = JSON.parse(rawText);
        } catch (parseErr) {
            return res.status(500).json({ success: false, error: 'A IA nao retornou JSON valido. Tente novamente ou preencha manualmente.', raw: rawText });
        }

        res.json({ success: true, dados: dadosExtraidos });
    } catch (error) {
        logger.error('Erro ao extrair dados dos modelos:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ROTAS - MODELOS DO ESCRITORIO


// Listar modelos
app.get('/api/modelos', requireUser, async (req, res) => {
    try {
        const dbModels = await prisma.knowledgeModel.findMany({
            include: { user: { select: { name: true } } },
            orderBy: { createdAt: 'desc' }
        });

        const arquivos = dbModels.map(m => {
            const filePath = path.join(MODELOS_DIR, m.nome);
            if (fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath);
                return {
                    nome: m.nome,
                    tamanho: stat.size,
                    criadoEm: m.createdAt,
                    adicionadoPor: m.user?.name || 'Sistema'
                };
            }
            return null;
        }).filter(Boolean);

        res.json({ success: true, modelos: arquivos });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Upload de modelo de texto — salvo na pasta /modelos
app.post('/api/modelos', requireUser, uploadModelo.array('modelos', 20), async (req, res) => {
    try {
        logger.info(`Recebendo ${req.files?.length || 0} arquivos para a biblioteca de modelos`);
        const salvos = [];
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
        }

        for (const file of req.files) {
            let originalName = file.originalname;
            try {
                const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
                if (decoded !== file.originalname && /[^\x00-\x7F]/.test(decoded)) {
                    originalName = decoded;
                }
            } catch (e) { }

            const destino = path.normalize(path.join(MODELOS_DIR, originalName));
            const atual = path.normalize(file.path);

            if (atual !== destino) {
                if (fs.existsSync(destino)) {
                    fs.unlinkSync(destino);
                }
                fs.renameSync(atual, destino);
            }

            // Salvar no Banco de Dados com o usuário que enviou
            await prisma.knowledgeModel.upsert({
                where: { nome: originalName },
                update: {
                    userId: req.body.userId || null,
                    createdAt: new Date()
                },
                create: {
                    nome: originalName,
                    userId: req.body.userId || null
                }
            });

            salvos.push(originalName);
        }
        res.json({ success: true, salvos });
    } catch (err) {
        logger.error('Erro no upload de modelos:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});


app.delete('/api/modelos/:nome', requireUser, (req, res) => {
    try {
        const filePath = path.join(MODELOS_DIR, req.params.nome);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROTA — GERAR PEÇA
// ═══════════════════════════════════════════════════════════════════════════
const cpUpload = uploadTemp.fields([{ name: 'documentos', maxCount: 10 }, { name: 'modelo_especifico', maxCount: 1 }]);

// ── ROTA DE EXTRAÇÃO (USANDO GEMINI 2.5 FLASH LITE) ─────────────────────────
app.post('/api/analyze-case', cpUpload, async (req, res) => {
    try {
        const files = req.files && req.files.documentos ? req.files.documentos : [];
        if (files.length === 0) return res.status(400).json({ success: false, error: 'Nenhum documento enviado para análise.' });

        const contents = [];
        contents.push(`
Você é um especialista em triagem de processos bancários. Sua missão é extrair os dados fundamentais do caso a partir dos documentos fornecidos.
Retorne APENAS um objeto JSON (sem explicações) com a seguinte estrutura:

{
  "processo": "Número do processo ou [PREENCHER]",
  "cliente": "Nome do autor",
  "reu": "Nome do banco",
  "valorCausa": "Valor da causa",
  "contratoNumero": "Número do contrato principal",
  "dataContrato": "Data da assinatura",
  "valorParcela": "Valor da parcela",
  "abusividades": ["Lista curta de irregularidades detectadas"]
}
`);

        for (const file of files) {
            let originalName = file.originalname;
            try { originalName = Buffer.from(file.originalname, 'latin1').toString('utf8'); } catch (e) { }
            const conteudo = await prepararConteudo(file.path, file.mimetype);
            if (conteudo) contents.push(conteudo);
            fs.unlinkSync(file.path);
        }

        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: [{ role: 'user', parts: contents.map(c => typeof c === 'string' ? { text: c } : c) }],
            config: { temperature: 0.1 },
        });
        logUsage(response.usageMetadata?.totalTokenCount || 0);

        const fullText = response.text;
        let facts = {};
        try {
            const jsonMatch = fullText.match(/\{[\s\S]*\}/);
            facts = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        } catch (e) { logger.error("Erro no parse de extração:", e); }

        res.json({ success: true, facts });
    } catch (error) {
        logger.error('Erro na extração:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/generate', requireUser, cpUpload, async (req, res) => {
    try {
        const files = req.files && req.files.documentos ? req.files.documentos : [];
        const modeloEspecifico = req.files && req.files.modelo_especifico ? req.files.modelo_especifico : [];

        // Dados confirmados pelo usuário no formulário de revisão
        const confirmedFacts = req.body.confirmedFacts ? JSON.parse(req.body.confirmedFacts) : null;
        const userId = req.body.userId;

        const contents = [];

        if (confirmedFacts) {
            contents.push(`\n\n=== DADOS REVISADOS E CONFIRMADOS PELO ADVOGADO (VERDADE ABSOLUTA DO CASO) ===\n${JSON.stringify(confirmedFacts, null, 2)}\n\n`);
        }

        // ── Prompt principal ──────────────────────────────────────────────
        const prompt = fs.readFileSync(path.join(__dirname, 'config', 'system_prompt.txt'), 'utf-8');



        // Injetando a data atual no contexto para o fechamento da peça
        const dataHoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        contents.push(`\nDATA ATUAL DO SISTEMA (use para o fechamento da peça): ${dataHoje}\n`);

        contents.push(prompt);

        // ── Carregar Base de Conhecimento do escritório ───────────────────
        const modeloArquivos = fs.readdirSync(MODELOS_DIR);
        if (modeloArquivos.length > 0) {
            contents.push('\n\n=== BASE DE CONHECIMENTO DO ESCRITÓRIO (PETIÇÕES ANTERIORES DE SUCESSO) ===\n[INSTRUÇÃO CRÍTICA]: Utilize as peças a seguir para extrair as TESES JURÍDICAS VENCEDORAS, a JURISPRUDÊNCIA adotada, e o TOM ARGUMENTATIVO característico do escritório. Adapte essas teses para os fatos do caso atual. Mantenha a estrutura e o estilo, mas NUNCA copie os dados pessoais (nomes, números de processo, valores, datas de eventos) destas peças de referência.\n');

            for (const nomeModelo of modeloArquivos) {
                const modeloPath = path.join(MODELOS_DIR, nomeModelo);
                const ext = nomeModelo.split('.').pop()?.toLowerCase();
                const mimeType = ext === 'pdf' ? 'application/pdf'
                    : ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                        : ext === 'txt' ? 'text/plain'
                            : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                                : ext === 'png' ? 'image/png'
                                    : 'text/plain';

                try {
                    const conteudo = await prepararConteudo(modeloPath, mimeType);
                    if (conteudo) {
                        if (typeof conteudo === 'string') {
                            contents.push(`\n--- MODELO: ${nomeModelo} ---\n${conteudo}\n`);
                        } else {
                            contents.push(`\n--- MODELO: ${nomeModelo} ---\n`);
                            contents.push(conteudo);
                        }
                    }
                } catch (e) {
                    logger.warn(`Não foi possível ler o modelo ${nomeModelo}:`, e.message);
                }
            }

            contents.push('\n=== FIM DOS MODELOS — A SEGUIR OS DOCUMENTOS DO CASO ATUAL ===\n');
        }

        // ── Processar Modelo Específico Opcional ──────────────────────────
        if (modeloEspecifico.length > 0) {
            contents.push('\n=== MODELO ESPECÍFICO PARA ESTA PEÇA (Prioridade MÁXIMA de estilo, estrutura e fluxo argumentativo) ===\n');
            for (const file of modeloEspecifico) {
                let originalName = file.originalname;
                try { originalName = Buffer.from(file.originalname, 'latin1').toString('utf8'); } catch (e) { }
                const conteudo = await prepararConteudo(file.path, file.mimetype);
                if (conteudo) {
                    if (typeof conteudo === 'string') { contents.push(conteudo); }
                    else { contents.push(conteudo); }
                }
                fs.unlinkSync(file.path);
            }
            contents.push('\n========================================================================\n');
        }

        // ── Processar documentos do caso ──────────────────────────────────
        for (const file of files) {
            let originalName = file.originalname;
            try {
                originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
            } catch (e) { }
            const conteudo = await prepararConteudo(file.path, file.mimetype);
            if (conteudo) {
                if (typeof conteudo === 'string') {
                    contents.push(conteudo);
                } else {
                    contents.push(conteudo);
                }
            }
            fs.unlinkSync(file.path);
        }

        // ── ESTÁGIO 1: ESTRATÉGIA E ANALYTICS (JSON) ─────────────────────────
        const contentsStage1 = [...contents];
        contentsStage1.push(`
# ESTÁGIO 1: ANÁLISE E ESTRATÉGIA (OBRIGATÓRIO: SCANNER DE CABEÇALHOS E DOCUMENTOS)
Neste momento, NÃO redija a peça processual. 
Sua missão crítica é varrer o documento anexado (que pode ter centenas de páginas) e LOCALIZAR A CONTESTAÇÃO.
1. Uma vez localizada a contestação, rastreie-a da primeira à última página extraindo TODOS os títulos e subtítulos (negrito/caixa alta) e coloque CADA UM na "matrizDuelo". 
2. Rastreie e extraia TODOS os documentos juntados ou mencionados pela parte ré e coloque-os na chave "documentosAdversos".
É PROIBIDO aglutinar argumentos ou documentos. Se o réu fez 15 tópicos e juntou 5 documentos, a "matrizDuelo" TEM QUE TER 15 ITENS e "documentosAdversos" 5 ITENS.
Gere APENAS o objeto JSON contendo as chaves: metadata, probabilidadeExito, estrategia, mapaContradicoes, matrizDuelo, documentosAdversos e mapaDeRiscos.
O campo "text" deve ser retornado vazio ("").
`);

        const formattedContents1 = [{
            role: 'user',
            parts: contentsStage1.map(c => typeof c === 'string' ? { text: c } : c)
        }];

        logger.info(`[DEBUG] Estágio 1 - Partes no conteúdo: ${formattedContents1[0].parts.length}`);
        const totalSize = JSON.stringify(formattedContents1).length;
        logger.info(`[DEBUG] Estágio 1 - Tamanho aproximado do payload: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

        let response1;
        try {
            logger.info("Iniciando Estágio 1: Extração de Estratégia...");
            response1 = await ai.models.generateContent({
                model: 'gemini-3.1-flash-lite',
                contents: formattedContents1,
                config: { temperature: 0.1 },
            });
        } catch (apiErr) {
            logger.error("!!! ERRO CRÍTICO NA API DO GEMINI (Estágio 1) !!!");
            logger.error("Status:", apiErr.status);
            logger.error("Mensagem:", apiErr.message);
            logger.error("Detalhes:", JSON.stringify(apiErr.response?.data || apiErr, null, 2));
            throw apiErr;
        }

        let fullText1 = response1.text;
        let responseData = { metadata: {}, timeline: [], mapaContradicoes: [], matrizDuelo: [], mapaDeRiscos: {} };
        let parseError = null;

        try {
            const jsonStart = fullText1.indexOf('{');
            const jsonEnd = fullText1.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                const jsonString = fullText1.substring(jsonStart, jsonEnd + 1);
                responseData = JSON.parse(jsonString);
            } else {
                parseError = "Formato JSON não encontrado no Estágio 1.";
            }
        } catch (e) {
            parseError = "Falha ao fazer parse do JSON no Estágio 1: " + e.message;
            logger.error(parseError, fullText1);
        }

        // Colheita de metadados reais de grounding do próprio Gemini (Estágio 1)
        let groundingLinks = responseData.fontesWeb || [];
        const metadataGround1 = response1.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (metadataGround1 && metadataGround1.length > 0) {
            const extraLinks1 = metadataGround1.map((chunk) => chunk?.web?.uri).filter(Boolean);
            groundingLinks = [...new Set([...groundingLinks, ...extraLinks1])];
        }

        // ── ESTÁGIO 2: REDAÇÃO DA PEÇA (MARKDOWN PURO) ────────────────────────
        const contentsStage2 = [...contents];
        contentsStage2.push(`
# RESULTADO DO ESTÁGIO 1 (ESTRATÉGIA DEFINIDA E MAPA DE TÓPICOS):
${JSON.stringify(responseData, null, 2)}

# ESTÁGIO 2: REDAÇÃO EXAUSTIVA DA PEÇA ESPELHADA
Com base na estratégia acima e nas matrizes geradas ("matrizDuelo" e "documentosAdversos"), redija AGORA a peça processual COMPLETA.
- NÃO retorne JSON.
- Retorne APENAS o texto da petição em formato MARKDOWN PURO.
- INCLUA OBRIGATORIAMENTE O CABEÇALHO COMPLETO DO ESCRITÓRIO (Endereçamento, número do processo, qualificações e nome da peça) exatamente como nos modelos fornecidos.
- REGRA DE OURO DO ESPELHAMENTO DE MÉRITO: Você DEVE criar um tópico/subtítulo de rebate na sua petição para CADA ITEM listado na "matrizDuelo" acima, na mesma ordem. É estritamente PROIBIDO fundir tópicos.
- REGRA DE OURO DO ESPELHAMENTO DOCUMENTAL: A sua Tabela de Impugnação Documental DEVE conter CADA UM dos itens listados em "documentosAdversos", sem pular nenhum, e DEVE conter a coluna de ID do documento.
- NÃO SE PREOCUPE COM O TAMANHO DA RESPOSTA. Seja EXTREMAMENTE EXAUSTIVO E DENSO em cada tópico.
`);

        const formattedContents2 = [{
            role: 'user',
            parts: contentsStage2.map(c => typeof c === 'string' ? { text: c } : c)
        }];

        logger.info("Iniciando Estágio 2: Redação Exaustiva da Peça...");
        const response2 = await ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
            contents: formattedContents2,
            config: { temperature: 0.1 },
        });

        const finalDocumentText = response2.text.replace(/^```markdown\n?/, '').replace(/```$/, '').trim();
        responseData.text = finalDocumentText;

        logger.info("=== GERAÇÃO DO ESTÁGIO 2 CONCLUÍDA ===");


        // Colheita de metadados de grounding (Estágio 2)
        const metadataGround2 = response2.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (metadataGround2 && metadataGround2.length > 0) {
            const extraLinks2 = metadataGround2.map((chunk) => chunk?.web?.uri).filter(Boolean);
            groundingLinks = [...new Set([...groundingLinks, ...extraLinks2])];
        }

        // ── Salvar no Histórico (Persistência Automática) ─────────────────
        let savedDocId = null;
        try {
            const savedDoc = await prisma.documentHistory.create({
                data: {
                    title: responseData.metadata?.titulo || 'Documento sem título',
                    clientName: responseData.metadata?.cliente || 'Cliente não identificado',
                    caseNumber: responseData.metadata?.processo || 'Sem processo',
                    content: responseData.text || '',
                    timeline: JSON.stringify(responseData.mapaContradicoes || responseData.timeline || []),
                    auditData: JSON.stringify(responseData.mapaDeRiscos || {}),
                    analytics: JSON.stringify({
                        prob: responseData.probabilidadeExito,
                        est: responseData.estrategia
                    }),
                    fontesWeb: JSON.stringify(groundingLinks),
                    matrizDuelo: JSON.stringify(responseData.matrizDuelo || []),
                    userId: userId
                }
            });
            savedDocId = savedDoc.id;

            // Dispara notificação no WhatsApp informando que a petição foi gerada
            notifyPetitionGenerated(savedDoc.title, savedDoc.caseNumber, savedDoc.clientName);

        } catch (dbError) {
            logger.error("Erro ao salvar no histórico:", dbError.message);
        }

        res.json({
            success: true,
            id: savedDocId,
            text: responseData.text || '',
            metadata: responseData.metadata || {},
            mapaContradicoes: responseData.mapaContradicoes || responseData.timeline || [],
            matrizDuelo: responseData.matrizDuelo || [],
            fontesWeb: groundingLinks,
            probabilidadeExito: responseData.probabilidadeExito,
            estrategia: responseData.estrategia,
            mapaDeRiscos: responseData.mapaDeRiscos || {}
        });
    } catch (error) {
        logger.error('Erro ao gerar documento:', error);
        res.status(500).json({ success: false, error: error.message || 'Erro ao processar a requisição.' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROTA — DOWNLOAD DOCX FORMATADO (COM SUPORTE A TEMPLATE)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/download-docx', async (req, res) => {
    try {
        const { text, metadata, nomeArquivo } = req.body;
        if (!text) {
            logger.error('Download DOCX: Texto não fornecido.');
            return res.status(400).json({ success: false, error: 'Texto não fornecido.' });
        }

        const config = lerConfig();
        const templatePath = path.join(TEMPLATES_DIR, 'modelo_base.docx');
        logger.info(`Download DOCX: Template existe? ${fs.existsSync(templatePath)}`);

        let buffer;

        // Se houver um template modelo_base.docx, usamos Docxtemplater
        if (fs.existsSync(templatePath)) {
            const content = fs.readFileSync(templatePath, 'binary');
            const zip = new PizZip(content);
            const { parseMarkdownToOOXML } = require('./docx-ooxml-parser');

            // Substituir {{corpo}} por {{@corpo}} para permitir a injeção nativa de XML (negrito, títulos, indentação)
            try {
                let docXml = zip.file("word/document.xml").asText();
                docXml = docXml.replace(/\{\{\s*corpo\s*\}\}/g, '{{@corpo}}');
                zip.file("word/document.xml", docXml);
            } catch (err) {
                logger.error("Erro ao preparar XML no template:", err);
            }

            const doc = new Docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
                delimiters: { start: '{{', end: '}}' },
            });

            // Preparar dados para o template
            const dadosParaTemplate = {
                ...config,
                ...metadata,
                corpo: parseMarkdownToOOXML(text),
                // Variáveis extras caso o usuário queira no template
                titulo: metadata.titulo || 'Peca Juridica',
                cliente: metadata.cliente || '',
                processo: metadata.processo || '',
                data: metadata.data || '',
                assinante: metadata.assinante || config.nomeAdvogado || '',
            };

            doc.render(dadosParaTemplate);
            buffer = doc.getZip().generate({ type: 'nodebuffer' });
            logger.info('Download DOCX: Gerado via template.');

        } else {
            return res.status(500).json({
                success: false,
                error: 'Template não encontrado: coloque o timbrado do escritório em backend/templates/modelo_base.docx.',
            });
        }

        const fileName = (nomeArquivo || 'Peca_Juridica').replace(/[^a-zA-Z0-9_\-]/g, '_') + '.docx';

        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': buffer.length,
        });
        res.send(buffer);
    } catch (error) {
        logger.error('Erro ao gerar DOCX:', error);

        // Log detalhado para Docxtemplater MultiError
        if (error.properties && error.properties.errors instanceof Array) {
            const errorMessages = error.properties.errors.map(e => {
                let msg = e.properties?.explanation || e.message || 'Erro desconhecido';
                if (e.properties?.id) msg += ` (ID: ${e.properties.id})`;
                return msg;
            });
            logger.error('Docxtemplater detalhes:', errorMessages);
            return res.status(500).json({
                success: false,
                error: 'Erro no template DOCX: os marcadores {{ }} do arquivo estão incorretos ou em formato inválido.',
                detalhes: errorMessages
            });
        }

        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROTAS DO HISTÓRICO DE CASOS GERADOS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/history', async (req, res) => {
    try {
        const history = await prisma.documentHistory.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                title: true,
                clientName: true,
                caseNumber: true,
                analytics: true,
                auditData: true,
                createdAt: true,
                isFavorite: true,
            }
        });
        res.json({ success: true, history });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/history/:id', async (req, res) => {
    try {
        const doc = await prisma.documentHistory.findUnique({
            where: { id: req.params.id }
        });
        if (!doc) return res.status(404).json({ success: false, error: 'Documento não encontrado' });

        // Converter strings JSON de volta para objetos (Necessário para SQLite)
        const formattedDoc = {
            ...doc,
            timeline: typeof doc.timeline === 'string' ? JSON.parse(doc.timeline) : doc.timeline,
            auditData: typeof doc.auditData === 'string' ? JSON.parse(doc.auditData) : doc.auditData,
            analytics: typeof doc.analytics === 'string' ? JSON.parse(doc.analytics) : doc.analytics,
            fontesWeb: typeof doc.fontesWeb === 'string' ? JSON.parse(doc.fontesWeb) : doc.fontesWeb,
            matrizDuelo: typeof doc.matrizDuelo === 'string' ? JSON.parse(doc.matrizDuelo) : doc.matrizDuelo,
            isFavorite: doc.isFavorite
        };

        res.json({ success: true, document: formattedDoc });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/history/:id', async (req, res) => {
    try {
        await prisma.documentHistory.delete({
            where: { id: req.params.id }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.put('/api/history/:id', async (req, res) => {
    try {
        const { content } = req.body;
        await prisma.documentHistory.update({
            where: { id: req.params.id },
            data: { content }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.put('/api/history/:id/favorite', async (req, res) => {
    try {
        const { isFavorite } = req.body;
        await prisma.documentHistory.update({
            where: { id: req.params.id },
            data: { isFavorite }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/evaluate-versions', async (req, res) => {
    try {
        const { docIds } = req.body;

        if (!docIds || !Array.isArray(docIds) || docIds.length < 2) {
            return res.status(400).json({ success: false, error: "Forneça pelo menos 2 IDs de documentos" });
        }

        const docs = await prisma.documentHistory.findMany({
            where: { id: { in: docIds } },
            orderBy: { createdAt: 'desc' }
        });

        if (docs.length < 2) return res.status(404).json({ success: false, error: "Documentos não encontrados suficientes" });

        let versionsText = "";
        docs.forEach((doc, idx) => {
            versionsText += `\n=== VERSÃO ${idx + 1} ===\n${doc.content}\n`;
        });

        const prompt = `
Você é um auditor jurídico sênior.
Sua missão é avaliar estas ${docs.length} versões de uma mesma peça processual e declarar a vencedora.

[REGRA DE FORMATAÇÃO CRÍTICA]:
SUA RESPOSTA DEVE TER NO MÁXIMO 3 PARÁGRAFOS CURTOS. SEJA EXTREMAMENTE SUCINTO E DIRETO AO PONTO. NUNCA GERE RESPOSTAS GIGANTESCAS, NEM LISTAS, NEM ANÁLISES TÓPICO A TÓPICO. VÁ DIRETO AO VEREDITO.

CRITÉRIOS ABSOLUTOS:
1. DENSIDADE E EXTENSÃO (O MAIS IMPORTANTE): Avalie de forma ESTritamente objetiva. A versão que contiver visivelmente MAIS TEXTO, tópicos mais longos e maior profundidade É OBRIGATORIAMENTE A VENCEDORA.
2. EXAUSTÃO: A versão que tiver a tabela de impugnação documental maior e mais detalhada ganha.
3. TERMINOLOGIA: É PROIBIDO usar a palavra "banco", "autor" ou "réu". As partes devem ser chamadas de "Requerente" e "Requerido".

DICA PARA CONSISTÊNCIA: Aja como um robô calculista. Se você rodar esta análise mil vezes, o resultado DEVE ser o mesmo. Pese o tamanho do texto e as violações de terminologia.

${versionsText}

Responda (EM NO MÁXIMO 3 PARÁGRAFOS CURTOS):
1. Qual versão é a VENCEDORA (Versão 1, Versão 2, Versão 3...)? Justifique brevemente focando em como ela foi mais extensa e densa.
2. Aponte rapidamente as falhas das perdedoras em 1 ou 2 frases.
`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { temperature: 0.0 },
        });

        res.json({ success: true, evaluation: response.text });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/analytics', async (req, res) => {
    try {
        const history = await prisma.documentHistory.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                analytics: true,
                auditData: true,
                createdAt: true,
                clientName: true,
                caseNumber: true,
                user: { select: { name: true } }
            }
        });

        const totalDocs = history.length;
        let totalProb = 0;
        let probCount = 0;

        const vulnerabilitiesByProcess = {}; // { vulnerabilityName: Set(caseNumbers) }
        const clientUniqueProcesses = {}; // { clientName: Set(caseNumbers) }
        const uniqueProcessNumbers = new Set();

        history.forEach(item => {
            const caseNum = (item.caseNumber || 'Sem-Processo').trim().toUpperCase();
            const clientName = (item.clientName || 'Cliente-Não-Identificado').trim().toUpperCase();

            uniqueProcessNumbers.add(caseNum);

            // Analytics (Probabilidade)
            if (item.analytics) {
                try {
                    const ana = JSON.parse(item.analytics);
                    const probVal = ana.prob || ana.probabilidade;
                    if (probVal) {
                        const val = parseInt(probVal.replace(/[^0-9]/g, ''));
                        if (!isNaN(val)) {
                            totalProb += val;
                            probCount++;
                        }
                    }
                } catch (e) { }
            }

            // Audit (Ilegalidades) - Contamos quantos PROCESSOS ÚNICOS têm essa ilegalidade
            if (item.auditData) {
                try {
                    const audit = JSON.parse(item.auditData);
                    (audit.vulnerabilidades || []).forEach(v => {
                        const vName = v.trim();
                        if (!vulnerabilitiesByProcess[vName]) vulnerabilitiesByProcess[vName] = new Set();
                        vulnerabilitiesByProcess[vName].add(caseNum);
                    });
                } catch (e) { }
            }

            // Clients - Contamos quantos PROCESSOS ÚNICOS cada cliente tem
            if (!clientUniqueProcesses[clientName]) clientUniqueProcesses[clientName] = new Set();
            clientUniqueProcesses[clientName].add(caseNum);
        });

        const avgProb = probCount > 0 ? Math.round(totalProb / probCount) : 0;
        const totalUniqueProcesses = uniqueProcessNumbers.size;

        // Transform and sort
        const topVulnerabilities = Object.entries(vulnerabilitiesByProcess)
            .map(([name, processSet]) => ({ name, count: processSet.size }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        const topClients = Object.entries(clientUniqueProcesses)
            .map(([name, processSet]) => ({ name, count: processSet.size }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        res.json({
            success: true,
            stats: {
                totalDocs,
                totalUniqueProcesses,
                avgProb,
                topVulnerabilities,
                topClients,
                recentCases: history.slice(0, 5).map(h => {
                    let prob = 'N/A';
                    if (h.analytics) {
                        try {
                            const ana = typeof h.analytics === 'string' ? JSON.parse(h.analytics) : h.analytics;
                            prob = ana.prob || ana.probabilidade || 'N/A';
                        } catch (e) { }
                    }
                    return {
                        id: h.id,
                        clientName: h.clientName,
                        caseNumber: h.caseNumber,
                        createdAt: h.createdAt,
                        userName: h.user?.name || 'Sistema',
                        prob
                    };
                })
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROTA DO PAINEL DE ADMINISTRADOR
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/admin/stats', async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            include: {
                _count: {
                    select: { documents: true }
                }
            }
        });
        const modelsCount = fs.existsSync(MODELOS_DIR) ? fs.readdirSync(MODELOS_DIR).length : 0;
        const historyCount = await prisma.documentHistory.count();

        res.json({
            success: true,
            stats: {
                users: users.length,
                models: modelsCount,
                cases: historyCount
            },
            userReports: users.map(u => ({
                id: u.id,
                name: u.name,
                email: u.email,
                docCount: u._count.documents,
                createdAt: u.createdAt
            }))
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Estatísticas individuais para o próprio usuário
app.get('/api/user/stats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                _count: {
                    select: { documents: true }
                }
            }
        });

        if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado' });

        const recentDocs = await prisma.documentHistory.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
                id: true,
                title: true,
                clientName: true,
                createdAt: true
            }
        });

        res.json({
            success: true,
            stats: {
                totalDocs: user._count.documents,
                name: user.name,
                email: user.email,
                memberSince: user.createdAt
            },
            recentDocs
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/prompt', (req, res) => {
    try {
        const promptPath = path.join(__dirname, 'config', 'system_prompt.txt');
        if (fs.existsSync(promptPath)) {
            const prompt = fs.readFileSync(promptPath, 'utf8');
            res.json({ success: true, prompt });
        } else {
            res.json({ success: true, prompt: '' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/prompt', (req, res) => {
    try {
        const { prompt } = req.body;
        if (typeof prompt !== 'string') {
            return res.status(400).json({ success: false, error: 'Formato inválido.' });
        }
        const configDir = path.join(__dirname, 'config');
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

        fs.writeFileSync(path.join(configDir, 'system_prompt.txt'), prompt, 'utf8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Buscar Configurações de Sistema (WhatsApp, etc)
app.get('/api/admin/settings', async (req, res) => {
    try {
        let settings = await prisma.systemSettings.findFirst();
        if (!settings) {
            settings = await prisma.systemSettings.create({ data: { whatsappGroupId: '', whatsappGroupName: '' } });
        }
        res.json({ success: true, settings });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Atualizar Configurações de Sistema
app.post('/api/admin/settings', async (req, res) => {
    try {
        const { whatsappGroupId, whatsappGroupName } = req.body;
        let settings = await prisma.systemSettings.findFirst();

        if (settings) {
            settings = await prisma.systemSettings.update({
                where: { id: settings.id },
                data: { whatsappGroupId, whatsappGroupName }
            });
        } else {
            settings = await prisma.systemSettings.create({
                data: { whatsappGroupId, whatsappGroupName }
            });
        }
        res.json({ success: true, settings });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Registar rotas
app.use('/api/whatsapp', requireAdmin, whatsappRoutes);
const tribunalRoutes = require('./src/routes/tribunalRoutes');
app.use('/api/processos', requireUser, tribunalRoutes);
const petitionRoutes = require('./src/routes/petitionRoutes');
app.use('/api/pieces', requireUser, petitionRoutes);
const jurimetriaRoutes = require('./src/routes/jurimetriaExpressRoutes');
app.use('/api', requireUser, jurimetriaRoutes);
const prazosRoutes = require('./src/routes/prazosRoutes');
app.use('/api/prazos', requireUser, prazosRoutes);
const intimacoesRoutes = require('./src/routes/intimacoesRoutes');
app.use('/api/intimacoes', requireUser, intimacoesRoutes);
const mniRoutes = require('./src/routes/mniRoutes');
app.use('/api/mni', requireUser, mniRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    logger.info(`Backend Central JVO rodando na porta ${PORT}`);
    logger.info(`Modelos do escritório: ${MODELOS_DIR}`);

    // Iniciar o robô do WhatsApp ao levantar o servidor
    if (process.env.DISABLE_WHATSAPP === 'true' || process.env.RENDER) {
        logger.info('Ambiente Render/Desativado detectado: Robô do WhatsApp ignorado para evitar falhas do Chromium.');
    } else {
        initializeWhatsApp();
    }
    // Configurar cron job (Diariamente às 07:00 da manhã)
    cron.schedule('0 7 * * *', async () => {
        logger.info('Executando Rotina Diária CRON - Notificações de Audiência...');
        await runDailyNotifications();
    });

    // Sincronização automática do DJEN — dias úteis, 06:30 em Cuiabá.
    // Guarda própria (NÃO a do WhatsApp): aquela desliga no Render por causa do
    // Chromium; este sync é fetch puro e o Render é produção — é onde precisa rodar.
    // Timezone explícito porque o Render roda em UTC e a OAB é MT (UTC-4): sem
    // isso, '30 6' dispararia 02:30 local e o rótulo "sincronizado às 06:30" mentiria.
    if (process.env.DISABLE_DJEN_CRON === 'true') {
        logger.info('Cron do DJEN desativado (DISABLE_DJEN_CRON=true).');
    } else {
        cron.schedule('30 6 * * 1-5', async () => {
            logger.info('[DJEN cron] Iniciando sincronização automática...');
            try {
                const r = await syncIntimacoesSafe();
                if (r.skipped) logger.warn('[DJEN cron] Pulado: já havia uma sincronização em andamento.');
                else logger.info(`[DJEN cron] ${r.criadas} nova(s) intimação(ões) (janela ${r.janela}).`);
            } catch (e) {
                // O servidor nunca cai por causa do sync; o heartbeat marca a falha.
                logger.error('[DJEN cron] Falhou:', e.message);
            }
        }, { timezone: 'America/Cuiaba' });
        logger.info('Cron do DJEN agendado: 06:30, dias úteis (America/Cuiaba).');
    }

    // Iniciar Workers em background (para Radar Preditivo funcionar em Produção/Render)
    if (process.env.RENDER) {
        try {
            logger.info('Iniciando Workers em background...');
            require('./dist/worker/worker.js');
        } catch (e) {
            logger.warn('Aviso: Worker não pôde ser iniciado. Certifique-se de ter rodado o build.', e.message);
        }
    }
});

// ── Tratamento de Fechamento (Evitar EPERM no Prisma) ───────────────────────
const gracefulShutdown = async (signal) => {
    logger.info(`\nRecebido ${signal}. Encerrando Central JVO de forma limpa...`);
    try {
        const { client: wsClient } = require('./src/services/whatsappService');
        if (wsClient) {
            logger.info('Encerrando navegador do WhatsApp...');
            await wsClient.destroy();
        }
        if (prisma) {
            await prisma.$disconnect();
            logger.info('Conexão com Banco de Dados encerrada.');
        }
    } catch (e) {
        logger.error('Erro no encerramento limpo:', e);
    }
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
    logger.error('Erro não tratado:', err);
    // Não encerramos imediatamente para evitar loop de restart se estiver em produção
});
