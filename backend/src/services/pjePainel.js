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
const { recordHeartbeat } = require('./djenService');

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
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
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
    const action = f.match(/action="([^"]+)"/);
    if (!action) throw new Error(`Formulário ${formId} sem action`);
    return { action: decodificar(action[1]), campos };
}

// ── Lista de expedientes ───────────────────────────────────────────────────
const RE_CNJ = /(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/;
const data = (dmy) => {
    const m = dmy && dmy.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])); // meia-noite local, como Prazo.fatalDate
    return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[1]) ? d : null; // 31/02 não "rola" para março
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
    if (!situacao.total) return { itens: [], incompletas: [] };

    const porId = new Map();
    // Caixa que não foi lida até o fim: o tribunal não pode aparecer como "ok"
    const incompletas = [];
    const htmlSituacao = await clicar(situacao.form, situacao.params);
    const jurisdicoes = linksA4j(htmlSituacao).filter((l) => l.params.ajaxSingle?.endsWith('::jNp') && l.total > 0);
    // Aba com N pendentes mas sem jurisdição na resposta = sessão derrubada / página de erro
    // com HTTP 200. Sem isto o tribunal voltava "0 expedientes" como se estivesse ok.
    if (!jurisdicoes.length) throw new Error(`painel listou ${situacao.total} pendente(s) mas não devolveu as jurisdições (sessão derrubada?)`);
    for (const jur of jurisdicoes) {
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
                itens.forEach((i) => porId.set(i.idExpediente, { ...i, orgao: i.orgao || jur.rotulo }));
                vistos += itens.length;
            }
            const lidos = porId.size - antes;
            (lidos < total ? logger.warn : logger.info).call(logger, `[PJe] ${jur.rotulo} › ${caixa.rotulo}: ${lidos} de ${total} lido(s)`);
            if (lidos < total) incompletas.push(`${jur.rotulo} › ${caixa.rotulo}: ${lidos} de ${total}`);
        }
    }
    return { itens: [...porId.values()], incompletas };
}

// ── Expediente ↔ intimação / prazo ─────────────────────────────────────────
const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const formatarCnj = (d) => (d && d.length === 20
    ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`
    : d);

// Vários expedientes no mesmo processo → o de expedição mais próxima da disponibilização no DJEN.
// O DJEN publica 1–3 dias depois do painel; mais de 15 dias é outro ato do mesmo processo,
// não este (sem o teto, uma intimação antiga casava com o expediente novo e sumia da fila).
const MAX_DIST_MS = 15 * 24 * 60 * 60 * 1000;
function melhorExpediente(intimacao, candidatos) {
    const ref = intimacao.dataDisponibilizacao ? new Date(intimacao.dataDisponibilizacao).getTime() : Date.now();
    const dist = (e) => (e.dataExpedicao ? Math.abs(new Date(e.dataExpedicao).getTime() - ref) : Infinity);
    const melhor = [...candidatos].sort((a, b) => dist(a) - dist(b))[0];
    return melhor && dist(melhor) <= MAX_DIST_MS ? melhor : null;
}

/**
 * Tira da caixa ("Novas" → "Distribuídas") toda intimação do DJEN cujo melhor
 * expediente já tem prazo vivo no quadro. Passada própria, sobre TODAS as novas:
 * a intimação costuma chegar depois do prazo nascer (painel lido às 06:40, DJEN
 * publica dias depois), então vincular só no instante da criação deixava o ato
 * em "Novas" e alguém gerava um 2º prazo à mão.
 */
async function vincularIntimacoesAoPje() {
    const novas = await prisma.intimacao.findMany({
        where: { status: 'NOVA', numeroProcesso: { not: null } },
        select: { id: true, numeroProcesso: true, dataDisponibilizacao: true },
    });
    const processos = [...new Set(novas.map((i) => soDigitos(i.numeroProcesso)).filter(Boolean))];
    if (!processos.length) return 0;
    const expedientes = await prisma.expedientePje.findMany({ where: { numeroProcesso: { in: processos }, prazoId: { not: null } } });
    // Prazo excluído no quadro deixa o prazoId órfão no expediente: só vincula a prazo que existe
    const vivos = new Set((await prisma.prazo.findMany({
        where: { id: { in: [...new Set(expedientes.map((e) => e.prazoId))] } }, select: { id: true },
    })).map((p) => p.id));
    const porProcesso = new Map();
    for (const e of expedientes) if (vivos.has(e.prazoId)) porProcesso.set(e.numeroProcesso, [...(porProcesso.get(e.numeroProcesso) || []), e]);
    let vinculadas = 0;
    for (const i of novas) {
        const e = melhorExpediente(i, porProcesso.get(soDigitos(i.numeroProcesso)) || []);
        if (!e) continue;
        const r = await prisma.intimacao.updateMany({
            where: { id: i.id, status: 'NOVA' },
            data: { status: 'GERADA', prazoId: e.prazoId, revisadoPor: 'Robô PJe', revisadoEm: new Date() },
        });
        vinculadas += r.count;
    }
    return vinculadas;
}

/**
 * Leva ao quadro, sem triagem manual, todo expediente com data limite do PJe:
 *  - cria o Prazo (fatalDate = data limite do PJe) e marca o expediente com o prazoId;
 *  - o mesmo ato intimado a N destinatários (N expedientes, mesmo processo e data
 *    limite) vira UM card — os demais expedientes apontam para ele;
 *  - tira da caixa as intimações do DJEN já cobertas por prazo do robô.
 * Prazo excluído no quadro não volta: o prazoId fica no expediente.
 * A data limite que muda no PJe é acompanhada em syncExpedientesPje (tem a data anterior).
 */
async function gerarPrazosDoPje() {
    let criados = 0;

    const novos = await prisma.expedientePje.findMany({ where: { dataLimite: { not: null }, prazoId: null } });
    for (const e of novos) {
        const caseReference = formatarCnj(e.numeroProcesso);
        const existente = caseReference && await prisma.prazo.findFirst({
            where: { source: 'PJE', caseReference, fatalDate: e.dataLimite },
            select: { id: true },
        });
        const prazo = existente || await prisma.prazo.create({
            data: {
                title: e.destinatario || caseReference || `Expediente ${e.idExpediente}`,
                caseReference,
                type: 'JUDICIAL',
                source: 'PJE',
                fatalDate: e.dataLimite,
                description: [e.tipo, e.prazoDias && `prazo ${e.prazoDias} dias`, e.tribunal, e.orgao, `expediente ${e.idExpediente} (PJe)`]
                    .filter(Boolean).join(' · '),
            },
        });
        await prisma.expedientePje.update({ where: { id: e.id }, data: { prazoId: prazo.id } });
        if (!existente) criados++;
    }

    const vinculadas = await vincularIntimacoesAoPje();
    return { criados, vinculadas };
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
    let atualizados = 0;
    try {
        for (const t of TRIBUNAIS) {
            try {
                const { itens, incompletas } = await lerTribunal(t);
                const agora = new Date();
                for (const { idExpediente, ...dados } of itens) {
                    const chave = { tribunal_idExpediente: { tribunal: t.sigla, idExpediente } };
                    const antes = await prisma.expedientePje.findUnique({ where: chave, select: { prazoId: true, dataLimite: true } });
                    await prisma.expedientePje.upsert({
                        where: chave,
                        create: { tribunal: t.sigla, idExpediente, ...dados, vistoEm: agora },
                        update: { ...dados, vistoEm: agora },
                    });
                    // Data limite mudou no PJe (ex.: suspensão) → acompanha, mas só se o card
                    // ainda está com a data anterior do PJe: data editada à mão é decisão humana.
                    const mudou = antes?.prazoId && antes.dataLimite && dados.dataLimite && antes.dataLimite.getTime() !== dados.dataLimite.getTime();
                    if (mudou) {
                        const r = await prisma.prazo.updateMany({
                            where: { id: antes.prazoId, status: 'PENDENTE', fatalDate: antes.dataLimite },
                            data: { fatalDate: dados.dataLimite },
                        });
                        atualizados += r.count;
                    }
                }
                resultado.push({
                    tribunal: t.sigla,
                    expedientes: itens.length,
                    // O que foi lido já está salvo acima; o erro só impede o falso "ok"
                    ...(incompletas.length ? { erro: `leitura incompleta (${incompletas.join('; ')})` } : {}),
                });
            } catch (e) {
                logger.error(`[PJe] ${t.sigla} falhou: ${e.message}`);
                resultado.push({ tribunal: t.sigla, erro: e.message });
            }
        }
        // Mesmo com um tribunal fora do ar, o que foi lido já vai para o quadro
        let erroQuadro;
        try {
            prazos = { ...(await gerarPrazosDoPje()), atualizados };
            logger.info(`[PJe] quadro: ${prazos.criados} prazo(s) criado(s), ${prazos.vinculadas} intimação(ões) vinculada(s), ${atualizados} data(s) atualizada(s)`);
        } catch (e) {
            erroQuadro = e;
            resultado.push({ tribunal: 'Quadro de prazos', erro: e.message });
        }
        // Fica no banco para o painel avisar — o cron não tem ninguém olhando o toast
        await recordHeartbeat({
            pjeLastAttemptAt: new Date(),
            pjeLastFalhas: resultado.filter((t) => t.erro).map(({ tribunal, erro }) => ({ tribunal, erro: String(erro).slice(0, 300) })),
        });
        if (erroQuadro) throw erroQuadro;
    } finally {
        emAndamento = false;
    }
    return { skipped: false, resultado, prazos };
}

module.exports = {
    syncExpedientesPje, gerarPrazosDoPje, lerExpedientes, parseLista, linksA4j, decodificar, configurado, alvoPermitido,
    soDigitos, formatarCnj, melhorExpediente,
};
