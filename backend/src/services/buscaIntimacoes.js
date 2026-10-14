// Busca estilo Discord: "chave:valor" vira filtro, o resto é texto livre.
// Ex.: tribunal:TJMT antes:2026-05-01 -status:DESCARTADA "prazo de 15 dias"
// Mesma ideia do tokenizador do Discord: chave = `${nome}:` (case-insensitive),
// valores repetidos da mesma chave viram OU, chaves diferentes viram E,
// "-" na frente nega, datas antes/em/depois viram faixa (lá: min_id/max_id).

// chave → campo do Prisma (contains insensitive) ou função que monta o filtro
const CAMPOS = {
    processo: 'numeroProcesso',
    tribunal: 'tribunal',
    tipo: 'tipoComunicacao',
    orgao: 'orgao',
    cliente: 'clienteExtraido',
    advogado: 'advogadoNome',
    oab: 'oabConsulta',
    status: (v) => ({ status: v.toUpperCase() }),
};
const DATAS = new Set(['antes', 'em', 'depois']);

// chave:"valor com espaço" | chave:valor | "frase" | palavra
const TOKEN = /(-?)([a-zà-ú]+):(?:"((?:\\.|[^"\\])*)"|(\S+))|"((?:\\.|[^"\\])*)"|(\S+)/gi;
const unescape = (s) => s.replace(/\\(.)/g, '$1');

// YYYY-MM-DD ou DD/MM/YYYY → início do dia local; inválida → null
function parseDia(v) {
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    return null;
}

function parseBusca(q) {
    const filtros = {}; // chave → { sim: [], nao: [] }
    const texto = [];
    const datas = {};
    for (const m of String(q || '').matchAll(TOKEN)) {
        const [, neg, chaveRaw, aspas, solto, frase, palavra] = m;
        const chave = chaveRaw?.toLowerCase();
        const valor = chave ? unescape(aspas ?? solto) : null;
        if (chave && DATAS.has(chave) && parseDia(valor)) { datas[chave] = parseDia(valor); continue; }
        if (chave && CAMPOS[chave] && valor) {
            const f = (filtros[chave] ??= { sim: [], nao: [] });
            (neg ? f.nao : f.sim).push(valor);
            continue;
        }
        // chave desconhecida (ex.: "http:") é texto, como no Discord (NON_TOKEN → content)
        texto.push(frase != null ? unescape(frase) : m[0]);
    }
    return { filtros, texto, datas };
}

function condicao(chave, valor) {
    const c = CAMPOS[chave];
    return typeof c === 'function' ? c(valor) : { [c]: { contains: valor, mode: 'insensitive' } };
}

// Resultado de parseBusca → where do Prisma
function buscaToWhere({ filtros, texto, datas }) {
    const AND = [];
    for (const [chave, { sim, nao }] of Object.entries(filtros)) {
        if (sim.length) AND.push({ OR: sim.map((v) => condicao(chave, v)) });
        for (const v of nao) AND.push({ NOT: condicao(chave, v) });
    }
    for (const t of texto) AND.push({ texto: { contains: t, mode: 'insensitive' } });
    const proxDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const faixa = {};
    if (datas.depois) faixa.gte = proxDia(datas.depois);
    if (datas.antes) faixa.lt = datas.antes;
    if (datas.em) { faixa.gte = datas.em; faixa.lt = proxDia(datas.em); }
    if (Object.keys(faixa).length) AND.push({ dataDisponibilizacao: faixa });
    return AND.length ? { AND } : {};
}

module.exports = { parseBusca, buscaToWhere, CHAVES: [...Object.keys(CAMPOS), ...DATAS] };
