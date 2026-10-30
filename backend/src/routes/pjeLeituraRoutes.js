// Rotas do robô do PJe (robo-pje/, no PC de quem tem o certificado). Montadas em /api/intimacoes/pje
// ANTES do JSON global do index.js: a leitura passa de 1 MB (o campo `partes` pesa).
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const logger = require('../infra/logger');
const prisma = require('../infra/prismaClient');
const pjePainel = require('../services/pjePainel'); // lido na chamada: os testes trocam gravarLeitura
const { TRIBUNAIS } = require('../services/pjeLeitura');
const { requireRoboOuUsuario } = require('../middleware/requireRobo');

router.use(express.json({ limit: '10mb' }));
router.use(requireRoboOuUsuario);

// ── Vez ────────────────────────────────────────────────────────────────────
// Um painel só (todo o escritório usa o certificado do Dr. Jesus) e o robô em vários PCs:
// antes de logar no PJe, o robô pede a vez. Só concede se ninguém está lendo e se a última
// leitura tem mais de ESPERA_MS — logins em sequência no SSO podem bloquear a conta do advogado,
// e vários PCs agendados às 06:40 leem uma vez só. Vez esquecida (robô travou) expira sozinha.
// ponytail: em memória, processo único; reiniciar o servidor zera a vez (a espera vem do banco).
const ESPERA_MS = 10 * 60_000;
const VEZ_MS = 20 * 60_000;
let vez = null; // { id, userId, nome, desde }

const nomeDe = (u) => u.name || u.email;
const hora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// POST /api/intimacoes/pje/vez → { vez } (id que acompanha o envio da leitura)
router.post('/vez', async (req, res) => {
    try {
        const agora = Date.now();
        if (vez && agora - vez.desde > VEZ_MS) vez = null;
        if (vez) {
            return res.status(409).json({ success: false, error: `${vez.nome} está lendo o PJe agora (desde ${hora(vez.desde)}). Não precisa ler de novo.` });
        }
        const s = await prisma.systemSettings.findFirst({ select: { pjeLastAttemptAt: true, pjeLastBy: true } });
        const ultima = s?.pjeLastAttemptAt?.getTime() || 0;
        if (agora - ultima < ESPERA_MS) {
            const libera = ultima + ESPERA_MS;
            return res.status(429).json({
                success: false,
                error: `O PJe foi lido às ${hora(ultima)}${s.pjeLastBy ? ` por ${s.pjeLastBy}` : ''}. Próxima leitura a partir de ${hora(libera)}.`,
                liberaEm: new Date(libera),
            });
        }
        vez = { id: crypto.randomUUID(), userId: req.currentUser.id, nome: nomeDe(req.currentUser), desde: agora };
        res.json({ success: true, vez: vez.id, expiraEm: new Date(agora + VEZ_MS) });
    } catch (error) {
        logger.error('[pje/vez] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao pedir a vez de leitura.' });
    }
});

// DELETE /api/intimacoes/pje/vez { vez } — o robô desistiu antes de ler (ex.: credencial do PC com problema)
router.delete('/vez', (req, res) => {
    if (vez && vez.id === req.body?.vez) vez = null;
    res.status(204).send();
});

// ── Leitura ────────────────────────────────────────────────────────────────
// Nada do que chega é confiável: só siglas conhecidas, só os campos do model, datas válidas.
const SIGLAS = new Set(TRIBUNAIS.map((t) => t.sigla));
const MAX_ITENS = 5000;
const TEXTOS = ['numeroProcesso', 'tipo', 'destinatario', 'meio', 'orgao', 'partes', 'situacao', 'jurisdicao', 'caixa'];
const DATAS = ['dataExpedicao', 'dataCiencia', 'dataLimite'];

function validarItem(i) {
    if (!i || typeof i.idExpediente !== 'string' || !/^\d{1,20}$/.test(i.idExpediente)) return { erro: 'item sem idExpediente válido' };
    const item = { idExpediente: i.idExpediente }; // campo fora da lista é descartado
    for (const c of TEXTOS) {
        if (i[c] == null) item[c] = null;
        else if (typeof i[c] === 'string') item[c] = i[c].slice(0, 2000);
        else return { erro: `${c} inválido no expediente ${i.idExpediente}` };
    }
    for (const c of DATAS) {
        if (i[c] == null) { item[c] = null; continue; }
        const d = typeof i[c] === 'string' ? new Date(i[c]) : null;
        if (!d || Number.isNaN(d.getTime())) return { erro: `${c} inválida no expediente ${i.idExpediente}` };
        item[c] = d;
    }
    if (i.prazoDias != null && !(Number.isInteger(i.prazoDias) && i.prazoDias >= 0 && i.prazoDias < 10_000)) {
        return { erro: `prazoDias inválido no expediente ${i.idExpediente}` };
    }
    item.prazoDias = i.prazoDias ?? null;
    item.cienciaPendente = i.cienciaPendente === true;
    return { item };
}

/** { versao: 1, tribunais: [...] } → { tribunais } normalizados, ou { erro } */
function validarLeitura(body) {
    if (body?.versao !== 1) return { erro: 'versao deve ser 1 (atualize o robô do PJe).' };
    if (!Array.isArray(body.tribunais)) return { erro: 'tribunais deve ser uma lista.' };
    const tribunais = [];
    const vistos = new Set();
    for (const t of body.tribunais) {
        if (!SIGLAS.has(t?.tribunal) || vistos.has(t.tribunal)) return { erro: `Tribunal desconhecido ou repetido: ${t?.tribunal}` };
        vistos.add(t.tribunal);
        if (typeof t.erro === 'string') { tribunais.push({ tribunal: t.tribunal, erro: t.erro.slice(0, 500) }); continue; }
        if (!Array.isArray(t.itens) || t.itens.length > MAX_ITENS) return { erro: `${t.tribunal}: itens deve ser uma lista de até ${MAX_ITENS}.` };
        if (!Array.isArray(t.incompletas)) return { erro: `${t.tribunal}: incompletas deve ser uma lista.` };
        const itens = [];
        for (const i of t.itens) {
            const r = validarItem(i);
            if (r.erro) return { erro: `${t.tribunal}: ${r.erro}` };
            itens.push(r.item);
        }
        tribunais.push({ tribunal: t.tribunal, itens, incompletas: t.incompletas.map((x) => String(x).slice(0, 300)) });
    }
    return { tribunais };
}

// POST /api/intimacoes/pje/leitura { versao: 1, vez, tribunais } → { resultado, prazos }
router.post('/leitura', async (req, res) => {
    if (!vez || vez.id !== req.body?.vez) {
        return res.status(409).json({ success: false, error: 'Sem a vez de leitura: peça a vez antes de ler o PJe (ou ela expirou).' });
    }
    vez = null; // a vez acaba aqui, com ou sem gravação
    const v = validarLeitura(req.body);
    if (v.erro) return res.status(400).json({ success: false, error: v.erro });
    try {
        const r = await pjePainel.gravarLeitura(v.tribunais, { usuario: nomeDe(req.currentUser) });
        res.json({ success: true, ...r });
    } catch (error) {
        logger.error('[pje/leitura] Erro:', error);
        res.status(500).json({ success: false, error: 'Erro ao gravar a leitura do PJe.' });
    }
});

module.exports = router;
module.exports.validarLeitura = validarLeitura; // exposto para teste
module.exports._zerarVez = () => { vez = null; }; // exposto para teste
