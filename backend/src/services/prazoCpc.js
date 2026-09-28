/**
 * Motor de prazos processuais (CPC) — funções puras, sem banco nem rede.
 *
 * Datas entram e saem como 'AAAA-MM-DD' (strings; datetime ISO é truncado).
 * Nada de Date local: toda aritmética em UTC para não escorregar de dia por fuso.
 *
 * Regras cobertas:
 *   - dias úteis (art. 219) e exclusão do dia do começo (art. 224, caput e §3º)
 *   - recesso forense 20/12 a 20/01, inclusive (art. 220)
 *   - feriados nacionais fixos + móveis (Carnaval, Sexta-feira Santa, Corpus Christi)
 *   - feriados locais/suspensões do tribunal via `extras` (portarias — não há como inferir)
 *   - prazo em dobro (Fazenda/MP/Defensoria, arts. 180, 183, 186) via `dobro`
 *   - ciência tácita do expediente PJe: 10 dias corridos (Lei 11.419/06, art. 5º, §3º)
 *   - DJEN: publicação = 1º dia útil após a disponibilização (Lei 11.419/06, art. 4º, §3º)
 */

const DIA_MS = 86400000;

const paraMs = (iso) => Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
const paraIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const somarDias = (iso, n) => paraIso(paraMs(iso) + n * DIA_MS);

// Domingo de Páscoa (algoritmo anônimo gregoriano / Meeus)
function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

const cacheFeriados = new Map();
function feriadosNacionais(ano) {
    if (cacheFeriados.has(ano)) return cacheFeriados.get(ano);
    const p = pascoa(ano);
    const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']
        .map((md) => `${ano}-${md}`);
    // Carnaval (seg/ter) é ponto facultativo, mas sem expediente forense na prática
    const moveis = [-48, -47, -2, 60].map((n) => somarDias(p, n));
    const set = new Set([...fixos, ...moveis]);
    cacheFeriados.set(ano, set);
    return set;
}

function emRecesso(iso) {
    const md = iso.slice(5, 10);
    return md >= '12-20' || md <= '01-20';
}

function ehDiaUtil(iso, extras = []) {
    const d = String(iso).slice(0, 10);
    const semana = new Date(paraMs(d)).getUTCDay();
    if (semana === 0 || semana === 6) return false;
    if (emRecesso(d)) return false;
    if (feriadosNacionais(Number(d.slice(0, 4))).has(d)) return false;
    return !extras.includes(d);
}

// Primeiro dia útil ESTRITAMENTE posterior a `iso`
function proximoDiaUtil(iso, extras = []) {
    let d = somarDias(iso, 1);
    while (!ehDiaUtil(d, extras)) d = somarDias(d, 1);
    return d;
}

// `iso` se já for útil; senão o próximo útil
const prorrogarSeNaoUtil = (iso, extras = []) =>
    (ehDiaUtil(iso, extras) ? String(iso).slice(0, 10) : proximoDiaUtil(iso, extras));

/**
 * Data fatal de um prazo em dias úteis.
 * @param {string} inicio data da intimação/ciência/publicação (dia do começo, excluído)
 * @param {number} dias   prazo legal em dias úteis
 */
function calcularPrazo({ inicio, dias, dobro = false, extras = [] }) {
    if (!inicio || !(dias > 0)) throw new Error('calcularPrazo: informe inicio e dias > 0');
    // ponytail: só dias úteis — prazo processual no CPC é sempre útil; corridos (material/penal) quando aparecer caso real
    let restante = dobro ? dias * 2 : dias;
    let d = String(inicio).slice(0, 10);
    while (restante > 0) {
        d = proximoDiaUtil(d, extras);
        restante--;
    }
    return d;
}

// Expediente PJe/MNI: ciência tácita no 10º dia corrido após a disponibilização,
// prorrogada ao próximo dia útil se cair em dia sem expediente.
const dataCienciaTacita = (dataDisponibilizacao, extras = []) =>
    prorrogarSeNaoUtil(somarDias(dataDisponibilizacao, 10), extras);

// DJEN: considera-se publicado no 1º dia útil seguinte à disponibilização.
const dataPublicacaoDjen = (dataDisponibilizacao, extras = []) =>
    proximoDiaUtil(dataDisponibilizacao, extras);

module.exports = {
    pascoa,
    feriadosNacionais,
    ehDiaUtil,
    proximoDiaUtil,
    calcularPrazo,
    dataCienciaTacita,
    dataPublicacaoDjen,
};
