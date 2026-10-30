/**
 * Leitura do Painel do Advogado do PJe — roda no PC de quem tem o certificado (robo-pje/),
 * nunca no servidor. Por isso NÃO importa prisma nem nada do backend além do pjeSso:
 * devolve a lista de expedientes e o servidor grava (pjePainel.gravarLeitura).
 *
 * Percorre Expedientes › abas de pendentes de resposta (ver escolherSituacoes) › jurisdição › caixa
 * reproduzindo os cliques AJAX (RichFaces A4J) por HTTP, sem navegador.
 * Guarda o prazo e a "Data limite prevista para manifestação" que o PRÓPRIO PJe
 * calculou — não fazemos conta de prazo aqui.
 *
 * ⚠️ SOMENTE LEITURA. Só clica em nós da árvore (situação/jurisdição/caixa) e na
 * paginação. NUNCA em "Tomar ciência", "Responder" ou no link do expediente:
 * esses dão ciência / abrem o ato. `clicar()` recusa qualquer alvo fora da lista.
 */
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

/**
 * Lê os tribunais em sequência (o mesmo certificado e o mesmo 2FA não podem logar em paralelo).
 * Um tribunal fora do ar não derruba os outros: vira { tribunal, erro }.
 * credenciais = { pfx: Buffer, senhaPfx, segredoTotp }; log = { info, warn } (padrão: console).
 */
async function lerPainel(credenciais, log = console) {
    const tribunais = [];
    for (const t of TRIBUNAIS) {
        try {
            const { itens, incompletas } = await lerTribunal(t, credenciais, log);
            tribunais.push({ tribunal: t.sigla, itens, incompletas });
        } catch (e) {
            log.warn(`[PJe] ${t.sigla} falhou: ${e.message}`);
            tribunais.push({ tribunal: t.sigla, erro: e.message });
        }
    }
    return tribunais;
}

async function lerTribunal(t, credenciais, log = console) {
    let erro;
    for (const url of t.urls) {
        try {
            return await lerExpedientes(url, credenciais, log);
        } catch (e) {
            erro = e;
            log.warn(`[PJe] ${t.sigla} via ${new URL(url).hostname} falhou: ${e.message}`);
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

// Teor do DJEN vem em HTML (<p>, <br>, <center><h2>…): o modal do card mostra texto.
// Tag de bloco vira quebra de linha; inline (<b>, <i>, <a>) só some, sem partir a frase.
const TAG_BLOCO = /<\/?(?:p|div|br|h[1-6]|center|li|tr|table|blockquote)\b[^>]*>/gi;
function teorEmTexto(html) {
    if (!html) return html;
    return decodificar(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(TAG_BLOCO, '\n').replace(/<[^>]+>/g, ''))
        .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
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

async function lerExpedientes(pjeUrl, credenciais, log = console) {
    const login = await loginCertificado({ pjeUrl, ...credenciais });
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

    const porId = new Map();
    // Caixa que não foi lida até o fim: o tribunal não pode aparecer como "ok"
    const incompletas = [];
    for (const situacao of escolherSituacoes(linksA4j(paginaInicial.texto)).filter((s) => s.total > 0)) {
        const htmlSituacao = await clicar(situacao.form, situacao.params);
        // A árvore mantém abertas as situações anteriores: só as jurisdições DESTA (…:listaAgrSitExp:<n>:…)
        const daSituacao = situacao.params.ajaxSingle.replace(/j_id\d+$/, '');
        const jurisdicoes = linksA4j(htmlSituacao).filter((l) => l.params.ajaxSingle?.endsWith('::jNp') && l.params.ajaxSingle.startsWith(daSituacao) && l.total > 0);
        // Aba com N pendentes mas sem jurisdição na resposta = sessão derrubada / página de erro
        // com HTTP 200. Sem isto o tribunal voltava "0 expedientes" como se estivesse ok.
        if (!jurisdicoes.length) throw new Error(`"${situacao.rotulo}" listou ${situacao.total} expediente(s) mas não devolveu as jurisdições (sessão derrubada?)`);
        for (const jur of jurisdicoes) {
            const htmlJur = await clicar(jur.form, jur.params);
            // A árvore mantém abertas as jurisdições anteriores: só as caixas DESTA (…:trPend:<id>:…)
            const doNo = jur.params.ajaxSingle.replace(/::jNp$/, ':');
            const caixas = linksA4j(htmlJur).filter((l) => l.params.ajaxSingle?.endsWith(':cxExItem') && l.params.ajaxSingle.startsWith(doNo) && l.total > 0);
            for (const caixa of caixas) {
                const origem = { situacao: situacao.rotulo, jurisdicao: jur.rotulo, caixa: caixa.rotulo };
                const daCaixa = new Set(); // por caixa: o mesmo expediente pode já ter vindo de outra aba
                let html = await clicar(caixa.form, caixa.params);
                let { total, itens } = parseLista(html);
                itens.forEach((i) => { daCaixa.add(i.idExpediente); porId.set(i.idExpediente, { ...i, orgao: i.orgao || jur.rotulo, ...origem }); });
                // paginação (datascroller) quando a caixa passa de uma página
                for (let pag = 2, vistos = itens.length; vistos < total && pag <= 50; pag++) {
                    html = await clicar('formExpedientes', {
                        'formExpedientes:tbExpedientes:scPendentes': String(pag), ajaxSingle: 'formExpedientes:tbExpedientes:scPendentes',
                    });
                    ({ itens } = parseLista(html));
                    if (!itens.length) break;
                    itens.forEach((i) => { daCaixa.add(i.idExpediente); porId.set(i.idExpediente, { ...i, orgao: i.orgao || jur.rotulo, ...origem }); });
                    vistos += itens.length;
                }
                const lidos = daCaixa.size;
                (lidos < total ? log.warn : log.info).call(log, `[PJe] ${jur.rotulo} › ${caixa.rotulo}: ${lidos} de ${total} lido(s)`);
                if (lidos < total) incompletas.push(`${jur.rotulo} › ${caixa.rotulo}: ${lidos} de ${total}`);
            }
        }
    }
    return { itens: [...porId.values()], incompletas };
}

// Abas do painel que o escritório acompanha: o que já teve ciência e espera resposta,
// o "sem prazo" e o que venceu sem resposta. "Pendentes de ciência" fica de fora DE
// PROPÓSITO (ainda não corre prazo); o card nasce quando a ciência é dada.
// TJMT tem "Apenas pendentes de resposta", que já é a soma das três abas de ciência
// dada/sem prazo; o TRF1 não tem essa aba, então lê as três.
const ABA_SOMA = /^Apenas pendentes de resposta/;
const ABAS_PARTES = [/^Ciência dada pelo destinatário/, /^Ciência dada pelo Judiciário/, /^Sem prazo/];
const ABA_FINDOU = /^Cujo prazo findou/;
function escolherSituacoes(links) {
    const temSoma = links.some((l) => ABA_SOMA.test(l.rotulo));
    const abas = links.filter((l) => ABA_FINDOU.test(l.rotulo)
        || (temSoma ? ABA_SOMA.test(l.rotulo) : ABAS_PARTES.some((re) => re.test(l.rotulo))));
    if (!abas.some((l) => !ABA_FINDOU.test(l.rotulo))) throw new Error('Abas de "pendentes de resposta" não encontradas no painel');
    return abas;
}

module.exports = {
    TRIBUNAIS, ABA_FINDOU, lerPainel, lerExpedientes, parseLista, linksA4j, decodificar, alvoPermitido,
    escolherSituacoes, teorEmTexto,
};
