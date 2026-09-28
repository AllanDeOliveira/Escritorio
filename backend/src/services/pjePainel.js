/**
 * Robô de leitura do Painel do Advogado do PJe → tabela expedientes_pje.
 *
 * Percorre Expedientes › "Pendentes de ciência ou de resposta" › jurisdição › caixa
 * reproduzindo os cliques AJAX (RichFaces A4J) por HTTP, sem navegador.
 * Guarda o prazo e a "Data limite prevista para manifestação" que o PRÓPRIO PJe
 * calculou — não fazemos conta de prazo aqui.
 *
 * ⚠️ SOMENTE LEITURA. Só clica em nós da árvore (situação/jurisdição/caixa) e na
 * paginação. NUNCA em "Tomar ciência", "Responder" ou no link do expediente:
 * esses dão ciência / abrem o ato. `clicar()` recusa qualquer alvo fora da lista.
 */
const logger = require('../infra/logger');
const prisma = require('../infra/prismaClient');
const { loginCertificado } = require('./pjeSso');

// Cada grau é um PJe separado (login e painel próprios). A sigla vira o filtro
// "Tribunal" do quadro e compõe a chave única do expediente.
// `urls` em ordem de preferência: se uma cair (o TJMT oscila muito), tenta a próxima.
// TJMT 1º grau: o host intranet é o mesmo sistema e respondeu ~3x mais rápido.
// TJMT 2º grau: o intranet derruba a sessão logo após o login (set/2026) — fica de reserva.
const TRIBUNAIS = [
    { sigla: 'TJMT', urls: ['https://pje-intranet.tjmt.jus.br/pje', 'https://pje.tjmt.jus.br/pje'] },
    { sigla: 'TJMT 2º GRAU', urls: ['https://pje2.tjmt.jus.br/pje2', 'https://pje2-intranet.tjmt.jus.br/pje2'] },
    { sigla: 'TRF1', urls: ['https://pje1g.trf1.jus.br/pje'] },
    { sigla: 'TRF1 2º GRAU', urls: ['https://pje2g.trf1.jus.br/pje'] },
];

async function lerTribunal(t) {
    let erro;
    for (const url of t.urls) {
        try {
            return await lerExpedientes(url);
        } catch (e) {
            erro = e;
            logger.warn(`[PJe] ${t.sigla} via ${new URL(url).hostname} falhou: ${e.message}`);
        }
    }
    throw erro;
}

// ── HTML ───────────────────────────────────────────────────────────────────
const DIACRITICO = { acute: '\u0301', grave: '\u0300', circ: '\u0302', tilde: '\u0303', uml: '\u0308', cedil: '\u0327' };
function decodificar(s) {
    return s
        .replace(/&([a-zA-Z])(acute|grave|circ|tilde|uml|cedil);/g, (_, l, d) => (l + DIACRITICO[d]).normalize('NFC'))
        .replace(/&ordm;/g, 'º').replace(/&ordf;/g, 'ª').replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function linhas(html) {
    return decodificar(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n'))
        .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// Links com A4J.AJAX.Submit: { rotulo, total, form, params }
function linksA4j(html) {
    const out = [];
    for (const m of html.matchAll(/<a[^>]*onclick="([^"]*A4J\.AJAX\.Submit[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
        const js = decodificar(m[1]).replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
        const form = (js.match(/A4J\.AJAX\.Submit\('([^']+)'/) || [])[1];
        const bloco = (js.match(/'parameters':\{([^}]*)\}/) || [])[1] || '';
        const params = Object.fromEntries([...bloco.matchAll(/'([^']+)':'([^']*)'/g)].map((p) => [p[1], p[2]]));
        const rotulo = linhas(m[2]).join(' ');
        // contador fica dentro do link (jurisdição) ou logo depois dele (caixa)
        const depois = linhas(html.slice(m.index + m[0].length, m.index + m[0].length + 400))[0] || '';
        const total = Number((rotulo.match(/(\d+)$/) || depois.match(/^(\d+)$/) || [])[1] || 0);
        if (form) out.push({ rotulo: rotulo.replace(/\s*\d+$/, ''), total, form, params });
    }
    return out;
}

function camposDoForm(html, formId) {
    const i = html.indexOf(`id="${formId}"`);
    if (i < 0) return null;
    const ini = html.lastIndexOf('<form', i);
    const f = html.slice(ini, html.indexOf('</form>', i));
    const campos = {};
    for (const [tag] of f.matchAll(/<input[^>]*>/g)) {
        const nome = (tag.match(/name="([^"]+)"/) || [])[1];
        const tipo = (tag.match(/type="([^"]+)"/) || [])[1];
        if (nome && !['submit', 'button', 'checkbox', 'image'].includes(tipo)) {
            campos[nome] = decodificar((tag.match(/value="([^"]*)"/) || [])[1] || '');
        }
    }
    return { action: decodificar(f.match(/action="([^"]+)"/)[1]), campos };
}

// ── Lista de expedientes ───────────────────────────────────────────────────
const RE_CNJ = /(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/;
const data = (dmy) => {
    const m = dmy && dmy.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null; // meia-noite local, como Prazo.fatalDate
};

function parseLista(html) {
    const total = Number((linhas(html).join(' ').match(/(\d+) resultados? encontrados?/) || [])[1] || 0);
    const itens = [];
    for (const linhaTr of html.split(/<tr[^>]*class="[^"]*rich-table-row/).slice(1)) {
        const L = linhas(linhaTr).filter((l) => l !== '>');
        const iTipo = L.findIndex((l) => /\(\d{6,}\)$/.test(l));
        if (iTipo < 0) continue;
        const t = L.join(' | ');
        const [, tipo, idExpediente] = L[iTipo].match(/^(.*?)\s*\((\d{6,})\)$/);
        const prazo = t.match(/Prazo:\s*(\d+)\s*dias?/i);
        itens.push({
            idExpediente,
            tipo,
            destinatario: L[iTipo - 1] && !/^(Responder|Tomar ciência)$/.test(L[iTipo - 1]) ? L[iTipo - 1] : null,
            meio: (L[iTipo + 1] || '').replace(/\s*\($/, '') || null,
            dataExpedicao: data(L[iTipo + 2]),
            prazoDias: prazo ? Number(prazo[1]) : null,
            cienciaPendente: /Data limite prevista para ciência|Tomar ciência/.test(t),
            dataCiencia: data((t.match(/ciência em (\d{2}\/\d{2}\/\d{4})/i) || [])[1]),
            dataLimite: data((t.match(/manifestação:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]),
            numeroProcesso: ((t.match(RE_CNJ) || [])[1] || '').replace(/\D/g, '') || null,
            partes: L.find((l) => / X /.test(l)) || null,
            orgao: (L.find((l) => l.startsWith('/')) || '').slice(1) || null,
        });
    }
    return { total, itens };
}

// ── Navegação ──────────────────────────────────────────────────────────────
// Whitelist EXATA de ids clicáveis. Atenção: "Tomar ciência" é
// formExpedientes:tbExpedientes:<idExpediente>:j_idNNN — um `:j_id\d+$` genérico deixaria passar.
const ALVOS_PERMITIDOS = [
    /^formAbaExpediente:listaAgrSitExp:\d+:j_id\d+$/, // situação
    /^formAbaExpediente:listaAgrSitExp:\d+:trPend:\d+::jNp$/, // jurisdição
    /^formAbaExpediente:listaAgrSitExp:\d+:trPend:\d+:-?\d+::j_id\d+:cxExItem$/, // caixa
    /^formExpedientes:tbExpedientes:scPendentes$/, // paginação
];
const alvoPermitido = (alvo) => ALVOS_PERMITIDOS.some((re) => re.test(alvo || ''));

async function lerExpedientes(pjeUrl) {
    const login = await loginCertificado({ pjeUrl });
    const { cliente } = login;
    let paginaInicial = login.paginaInicial;
    // Alguns PJe abrem antes o Quadro de Avisos (ex.: TRF1 2º grau) — vai direto ao painel
    if (!/advogado\.seam/.test(paginaInicial.url)) {
        paginaInicial = await cliente.ir(`${pjeUrl}/Painel/painel_usuario/advogado.seam`);
    }
    if (!/advogado\.seam/.test(paginaInicial.url)) throw new Error(`Não caiu no Painel do Advogado (${paginaInicial.url})`);
    let viewState = (paginaInicial.texto.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/) || [])[1];
    const paginas = [paginaInicial.texto]; // formulários podem vir de qualquer resposta anterior

    async function clicar(form, params) {
        const alvo = params.ajaxSingle;
        if (!alvoPermitido(alvo)) throw new Error(`Clique recusado (fora da árvore): ${alvo}`);
        const f = paginas.map((p) => camposDoForm(p, form)).reverse().find(Boolean);
        if (!f) throw new Error(`Formulário ${form} não encontrado`);
        const r = await cliente.ir(new URL(f.action, paginaInicial.url).toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Referer: paginaInicial.url },
            body: new URLSearchParams({
                AJAXREQUEST: '_viewRoot', ...f.campos, 'javax.faces.ViewState': viewState, ...params, 'AJAX:EVENTS_COUNT': '1',
            }).toString(),
        });
        if (r.status !== 200) throw new Error(`PJe respondeu HTTP ${r.status}`);
        viewState = (r.texto.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/) || [])[1] || viewState;
        paginas.push(r.texto);
        return r.texto;
    }

    const situacao = linksA4j(paginaInicial.texto).find((l) => /^Pendentes de ciência ou de resposta/.test(l.rotulo));
    if (!situacao) throw new Error('Aba "Pendentes de ciência ou de resposta" não encontrada');
    if (!situacao.total) return [];

    const porId = new Map();
    const htmlSituacao = await clicar(situacao.form, situacao.params);
    for (const jur of linksA4j(htmlSituacao).filter((l) => l.params.ajaxSingle?.endsWith('::jNp') && l.total > 0)) {
        const htmlJur = await clicar(jur.form, jur.params);
        // A árvore mantém abertas as jurisdições anteriores: só as caixas DESTA (…:trPend:<id>:…)
        const doNo = jur.params.ajaxSingle.replace(/::jNp$/, ':');
        const caixas = linksA4j(htmlJur).filter((l) => l.params.ajaxSingle?.endsWith(':cxExItem') && l.params.ajaxSingle.startsWith(doNo) && l.total > 0);
        for (const caixa of caixas) {
            const antes = porId.size;
            let html = await clicar(caixa.form, caixa.params);
            let { total, itens } = parseLista(html);
            itens.forEach((i) => porId.set(i.idExpediente, { ...i, orgao: i.orgao || jur.rotulo }));
            // paginação (datascroller) quando a caixa passa de uma página
            for (let pag = 2, vistos = itens.length; vistos < total && pag <= 50; pag++) {
                html = await clicar('formExpedientes', {
                    'formExpedientes:tbExpedientes:scPendentes': String(pag), ajaxSingle: 'formExpedientes:tbExpedientes:scPendentes',
                });
                ({ itens } = parseLista(html));
                if (!itens.length) break;
                itens.forEach((i) => porId.set(i.idExpediente, i));
                vistos += itens.length;
            }
            const lidos = porId.size - antes;
            (lidos < total ? logger.warn : logger.info).call(logger, `[PJe] ${jur.rotulo} › ${caixa.rotulo}: ${lidos} de ${total} lido(s)`);
        }
    }
    return [...porId.values()];
}

// ── Expediente ↔ intimação / prazo ─────────────────────────────────────────
const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const formatarCnj = (d) => (d && d.length === 20
    ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`
    : d);

// Vários expedientes no mesmo processo → o de expedição mais próxima da disponibilização no DJEN
function melhorExpediente(intimacao, candidatos) {
    const ref = intimacao.dataDisponibilizacao ? new Date(intimacao.dataDisponibilizacao).getTime() : Date.now();
    const dist = (e) => Math.abs((e.dataExpedicao ? new Date(e.dataExpedicao).getTime() : 0) - ref);
    return [...candidatos].sort((a, b) => dist(a) - dist(b))[0] || null;
}

/**
 * Leva ao quadro, sem triagem manual, todo expediente com data limite do PJe:
 *  - cria o Prazo (fatalDate = data limite do PJe) e marca o expediente com o prazoId;
 *  - tira da caixa ("Novas" → "Distribuídas") as intimações do DJEN que correspondem a ele;
 *  - se o PJe mudar a data limite de um prazo ainda pendente, acompanha.
 * Prazo excluído no quadro não volta: o prazoId fica no expediente.
 */
async function gerarPrazosDoPje() {
    let criados = 0; let atualizados = 0;

    const novos = await prisma.expedientePje.findMany({ where: { dataLimite: { not: null }, prazoId: null } });
    for (const e of novos) {
        const prazo = await prisma.prazo.create({
            data: {
                title: e.destinatario || formatarCnj(e.numeroProcesso) || `Expediente ${e.idExpediente}`,
                caseReference: formatarCnj(e.numeroProcesso),
                type: 'JUDICIAL',
                source: 'PJE',
                fatalDate: e.dataLimite,
                description: [e.tipo, e.prazoDias && `prazo ${e.prazoDias} dias`, e.tribunal, e.orgao, `expediente ${e.idExpediente} (PJe)`]
                    .filter(Boolean).join(' · '),
            },
        });
        await prisma.expedientePje.update({ where: { id: e.id }, data: { prazoId: prazo.id } });
        criados++;

        // Intimações novas do mesmo processo cujo melhor expediente é este
        const doProcesso = await prisma.expedientePje.findMany({ where: { numeroProcesso: e.numeroProcesso } });
        const intimacoes = await prisma.intimacao.findMany({
            where: { status: 'NOVA', numeroProcesso: { in: [e.numeroProcesso, formatarCnj(e.numeroProcesso)] } },
        });
        const ids = intimacoes.filter((i) => melhorExpediente(i, doProcesso)?.id === e.id).map((i) => i.id);
        if (ids.length) {
            await prisma.intimacao.updateMany({
                where: { id: { in: ids }, status: 'NOVA' },
                data: { status: 'GERADA', prazoId: prazo.id, revisadoPor: 'Robô PJe', revisadoEm: new Date() },
            });
        }
    }

    // Data limite mudou no PJe (ex.: suspensão) → acompanha enquanto o prazo estiver pendente
    const vinculados = await prisma.expedientePje.findMany({ where: { dataLimite: { not: null }, prazoId: { not: null } } });
    const prazos = await prisma.prazo.findMany({
        where: { id: { in: vinculados.map((e) => e.prazoId) }, status: 'PENDENTE' },
        select: { id: true, fatalDate: true },
    });
    const limitePorPrazo = new Map(vinculados.map((e) => [e.prazoId, e.dataLimite]));
    for (const p of prazos) {
        const limite = limitePorPrazo.get(p.id);
        if (limite && limite.getTime() !== p.fatalDate.getTime()) {
            await prisma.prazo.update({ where: { id: p.id }, data: { fatalDate: limite } });
            atualizados++;
        }
    }
    return { criados, atualizados };
}

// ── Sincronização ──────────────────────────────────────────────────────────
let emAndamento = false;

function configurado() {
    return Boolean(process.env.MNI_CERT_PATH && process.env.MNI_CERT_SENHA && process.env.PJE_TOTP_SECRET);
}

async function syncExpedientesPje() {
    if (!configurado()) return { skipped: true, motivo: 'MNI_CERT_PATH / MNI_CERT_SENHA / PJE_TOTP_SECRET não configurados' };
    if (emAndamento) return { skipped: true, motivo: 'já em andamento' };
    emAndamento = true;
    const resultado = [];
    let prazos;
    try {
        for (const t of TRIBUNAIS) {
            try {
                const itens = await lerTribunal(t);
                const agora = new Date();
                for (const { idExpediente, ...dados } of itens) {
                    await prisma.expedientePje.upsert({
                        where: { tribunal_idExpediente: { tribunal: t.sigla, idExpediente } },
                        create: { tribunal: t.sigla, idExpediente, ...dados, vistoEm: agora },
                        update: { ...dados, vistoEm: agora },
                    });
                }
                resultado.push({ tribunal: t.sigla, expedientes: itens.length });
            } catch (e) {
                logger.error(`[PJe] ${t.sigla} falhou: ${e.message}`);
                resultado.push({ tribunal: t.sigla, erro: e.message });
            }
        }
        // Mesmo com um tribunal fora do ar, o que foi lido já vai para o quadro
        prazos = await gerarPrazosDoPje();
        logger.info(`[PJe] quadro: ${prazos.criados} prazo(s) criado(s), ${prazos.atualizados} data(s) atualizada(s)`);
    } finally {
        emAndamento = false;
    }
    return { skipped: false, resultado, prazos };
}

module.exports = {
    syncExpedientesPje, gerarPrazosDoPje, lerExpedientes, parseLista, linksA4j, decodificar, configurado, alvoPermitido,
    soDigitos, formatarCnj, melhorExpediente,
};
