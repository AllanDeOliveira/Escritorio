/**
 * Gravação da leitura do Painel do Advogado do PJe → tabela expedientes_pje → quadro.
 * A leitura em si (login com o certificado, cliques no painel) roda no PC de quem tem o
 * certificado (robo-pje/ + pjeLeitura.js) e chega pronta em POST /api/intimacoes/pje/leitura:
 * o servidor nunca guarda certificado, senha do certificado nem segredo do 2FA.
 *
 * ponytail: UM painel só — o escritório inteiro usa o certificado do Dr. Jesus, e a baixa
 * automática é por tribunal. Um 2º certificado exige separar por painel (spec 2026-10-30, 3.2).
 */
const logger = require('../infra/logger');
const prisma = require('../infra/prismaClient');
const { ABA_FINDOU } = require('./pjeLeitura');
const { recordHeartbeat } = require('./djenService');

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
    // Só vincula a card que existe e não está na lixeira (CANCELADO): intimação ligada a card
    // excluído ficaria invisível — se for ato novo, é prazo perdido. Sem vínculo, vira card próprio.
    const vivos = new Set((await prisma.prazo.findMany({
        where: { id: { in: [...new Set(expedientes.map((e) => e.prazoId))] }, status: { not: 'CANCELADO' } }, select: { id: true },
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

const meiaNoite = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// O robô não lê "pendentes de ciência": o DJEN publica antes de o expediente aparecer
// no painel, e o ato já tem card do DJEN. O PJe assume esse card em vez de abrir um 2º —
// dono e intimações vinculadas ficam. Vale também para o card cuja data alguém já
// confirmou à mão (PENDENTE): antes só o "a confirmar" contava e o PJe duplicava o card.
async function cardDoDjen(caseReference, e) {
    const cards = await prisma.prazo.findMany({
        where: { source: 'DJEN', status: { in: ['A_CONFIRMAR', 'PENDENTE'] }, caseReference },
        select: { id: true, status: true, fatalDate: true, intimacoes: { select: { tipoDocumento: true, tipoComunicacao: true, dataDisponibilizacao: true }, take: 1 } },
    });
    if (!cards.length) return null;
    // Card do DJEN já ligado a um expediente é de outro ato (o mesmo ato a N destinatários
    // é pego antes, pelo expediente irmão): assumir de novo esconderia um prazo novo
    const ligados = new Set((await prisma.expedientePje.findMany({
        where: { prazoId: { in: cards.map((c) => c.id) } }, select: { prazoId: true },
    })).map((x) => x.prazoId));
    // Proximidade pela disponibilização no DJEN (o fatalDate do card confirmado já é o prazo)
    const livres = cards.filter((c) => !ligados.has(c.id))
        .map((c) => ({ ...c, dataExpedicao: c.intimacoes[0]?.dataDisponibilizacao || c.fatalDate }));
    const ref = { dataDisponibilizacao: e.dataExpedicao };
    // Mesmo tipo de ato primeiro: o processo pode ter Decisão e Sentença na mesma quinzena
    return melhorExpediente(ref, livres.filter((c) => mesmoTipo(tipoDoCard(c), e.tipo))) || melhorExpediente(ref, livres);
}

// "Intimação de pauta" (DJEN) = "Intimação de Pauta" (PJe): compara sem caixa nem acento
const normTipo = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const mesmoTipo = (a, b) => Boolean(normTipo(a)) && normTipo(a) === normTipo(b);
const tipoDoCard = (c) => c.intimacoes?.[0]?.tipoDocumento || c.intimacoes?.[0]?.tipoComunicacao;

/**
 * O DJEN às vezes publica o mesmo ato de novo (ex.: decisão sigilosa em 05/10 e 06/10) e
 * a 2ª publicação vira outro card "a confirmar". Se já existe card aberto do PJe no mesmo
 * processo, com o MESMO tipo de ato e expedição a até 15 dias, o card do DJEN é duplicado:
 * as intimações passam para o card do PJe e o do DJEN é cancelado (sai do quadro, não
 * some do banco). Tipo diferente (Sentença × Intimação) pode ser outro ato: fica para
 * alguém olhar no "A confirmar".
 */
async function juntarDuplicadosDjen() {
    const djen = await prisma.prazo.findMany({
        where: { source: 'DJEN', status: 'A_CONFIRMAR', caseReference: { not: null } },
        select: { id: true, caseReference: true, fatalDate: true, responsibleId: true, responsibleName: true, intimacoes: { select: { tipoDocumento: true, tipoComunicacao: true }, take: 1 } },
    });
    if (!djen.length) return 0;
    const processos = [...new Set(djen.map((d) => soDigitos(d.caseReference)))];
    const exps = await prisma.expedientePje.findMany({
        where: { numeroProcesso: { in: processos }, prazoId: { not: null } },
        select: { prazoId: true, numeroProcesso: true, tipo: true, dataExpedicao: true },
    });
    const abertos = new Set((await prisma.prazo.findMany({
        where: { id: { in: exps.map((e) => e.prazoId) }, status: { in: ['PENDENTE', 'A_CONFIRMAR'] } }, select: { id: true },
    })).map((p) => p.id));
    let juntados = 0;
    for (const d of djen) try {
        const candidatos = exps.filter((e) => abertos.has(e.prazoId) && e.numeroProcesso === soDigitos(d.caseReference) && mesmoTipo(tipoDoCard(d), e.tipo));
        const alvo = melhorExpediente({ dataDisponibilizacao: d.fatalDate }, candidatos);
        if (!alvo) continue;
        await prisma.$transaction([
            prisma.intimacao.updateMany({ where: { prazoId: d.id }, data: { prazoId: alvo.prazoId } }),
            // Dono que alguém já deu ao duplicado passa para o card que fica (se ele não tiver)
            ...(d.responsibleId ? [prisma.prazo.updateMany({ where: { id: alvo.prazoId, responsibleId: null }, data: { responsibleId: d.responsibleId, responsibleName: d.responsibleName } })] : []),
            prisma.prazo.update({ where: { id: d.id }, data: { status: 'CANCELADO', lastMovedBy: 'Robô PJe', lastMovedAt: new Date() } }),
        ]);
        juntados++;
    } catch (err) {
        logger.error(`[quadro] card ${d.id} do DJEN não foi juntado:`, err);
    }
    return juntados;
}

// Dono por processo: o último card do mesmo processo que tem dono passa o dono adiante.
// A memória é o próprio quadro — "Pegar" num card assume o processo (rota /pegar).
// ponytail: se um dia o processo precisar de dono oficial diferente do último card,
// vira campo na ação judicial.
async function donoDoProcesso(caseReference) {
    if (!caseReference) return {};
    const ultimo = await prisma.prazo.findFirst({
        where: { caseReference, responsibleId: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: { responsibleId: true, responsibleName: true },
    });
    return ultimo || {};
}

/**
 * Leva ao quadro, sem triagem manual, TODO expediente do painel:
 *  - com data limite do PJe → card PENDENTE (fatalDate = data limite);
 *  - sem data (pauta, "sem prazo", ciência pendente) → card A_CONFIRMAR com a expedição
 *    como piso; quem assume informa a data real, ou o PJe passa a mostrá-la
 *    (gravarLeitura troca para PENDENTE);
 *  - o mesmo ato a N destinatários (N expedientes, mesmo processo e data) vira UM card;
 *  - tira da caixa as intimações do DJEN já cobertas por card do robô;
 *  - o que sobrou na caixa vira card A_CONFIRMAR (gerarCardsDoDjen).
 * Prazo excluído no quadro não volta: o prazoId fica no expediente.
 */
async function gerarQuadro() {
    let criados = 0;

    const novos = await prisma.expedientePje.findMany({ where: { prazoId: null } });
    // Um expediente com erro não pode travar os demais nem os cards do DJEN que vêm depois
    for (const e of novos) try {
        const caseReference = formatarCnj(e.numeroProcesso);
        const fatalDate = e.dataLimite || meiaNoite(e.dataExpedicao || e.vistoEm);
        // Mesmo ato a N destinatários = expediente irmão (mesmo processo, tribunal, tipo e dia
        // de expedição) que já tem card. Antes era processo + data: Decisão e Intimação de
        // pauta do mesmo dia viravam um card só e uma delas sumia.
        const irmao = e.numeroProcesso && await prisma.expedientePje.findFirst({
            where: { id: { not: e.id }, tribunal: e.tribunal, numeroProcesso: e.numeroProcesso, tipo: e.tipo, dataExpedicao: e.dataExpedicao, prazoId: { not: null } },
            select: { prazoId: true },
        });
        // Se o card do irmão foi excluído, o id órfão fica aqui também: exclusão é decisão humana
        const existente = irmao ? { id: irmao.prazoId } : null;
        const doPje = {
            source: 'PJE',
            status: e.dataLimite ? 'PENDENTE' : 'A_CONFIRMAR',
            fatalDate,
            description: [e.tipo, e.prazoDias && `prazo ${e.prazoDias} dias`,
                !e.dataLimite && (e.cienciaPendente ? 'ciência pendente no PJe' : 'sem data limite no PJe'),
                e.tribunal, e.orgao, `expediente ${e.idExpediente} (PJe)`]
                .filter(Boolean).join(' · '),
        };
        const djen = !existente && caseReference && await cardDoDjen(caseReference, e);
        const prazo = existente
            || (djen && (djen.status === 'A_CONFIRMAR'
                ? await prisma.prazo.update({ where: { id: djen.id }, data: doPje })
                // Data confirmada à mão é decisão humana: só liga o expediente ao card
                : djen))
            || await prisma.prazo.create({
                data: {
                    title: e.destinatario || caseReference || `Expediente ${e.idExpediente}`,
                    caseReference,
                    type: 'JUDICIAL',
                    ...doPje,
                    ...(await donoDoProcesso(caseReference)),
                },
            });
        await prisma.expedientePje.update({ where: { id: e.id }, data: { prazoId: prazo.id } });
        if (!existente && !djen) criados++;
    } catch (err) {
        logger.error(`[quadro] expediente ${e.idExpediente} não virou card:`, err);
    }

    const vinculadas = await vincularIntimacoesAoPje();
    const djen = await gerarCardsDoDjen();
    const juntados = await juntarDuplicadosDjen();
    return { criados, vinculadas, djen, juntados };
}

// ponytail: fila em memória, processo único. Cron do DJEN, cron do PJe e os botões
// chamam isto; em série, nunca nascem dois cards para o mesmo ato.
let fila = Promise.resolve();
function gerarPrazosDoPje() {
    fila = fila.catch(() => {}).then(gerarQuadro);
    return fila;
}

/**
 * Intimação do DJEN sem par no PJe (o TJMT publica no Diário muito ato que nunca
 * entra em "pendentes de ciência"; o TRT23 não tem robô) virava fila de triagem
 * manual que ninguém esvaziava. Agora vira card A_CONFIRMAR: a disponibilização no
 * DJEN é o piso, quem assume informa a data fatal. Cópias do mesmo ato
 * (processo + data + texto, como no gerar-prazo manual) viram um card só.
 */
async function gerarCardsDoDjen() {
    const novas = await prisma.intimacao.findMany({ where: { status: 'NOVA' }, orderBy: { createdAt: 'asc' } });
    const porAto = new Map();
    for (const i of novas) {
        const k = `${i.numeroProcesso}|${i.dataDisponibilizacao?.getTime()}|${i.texto}`;
        porAto.set(k, [...(porAto.get(k) || []), i]);
    }
    let criados = 0;
    for (const grupo of porAto.values()) try {
        const [i] = grupo;
        const revisao = { revisadoPor: 'Robô DJEN', revisadoEm: new Date() };
        // Reivindica antes de criar (mesmo padrão do gerar-prazo manual): quem perder a
        // corrida vê count 0 e não cria um segundo card.
        const criou = await prisma.$transaction(async (tx) => {
            const claim = await tx.intimacao.updateMany({ where: { id: i.id, status: 'NOVA' }, data: { status: 'GERADA', ...revisao } });
            if (!claim.count) return false;
            const dig = soDigitos(i.numeroProcesso);
            const caseReference = (dig.length === 20 ? formatarCnj(dig) : i.numeroProcesso) || null;
            const prazo = await tx.prazo.create({
                data: {
                    title: i.clienteExtraido || caseReference || `Intimação ${i.djenId}`,
                    caseReference,
                    type: 'JUDICIAL',
                    source: 'DJEN',
                    status: 'A_CONFIRMAR',
                    fatalDate: i.dataDisponibilizacao || meiaNoite(i.createdAt),
                    ...(await donoDoProcesso(caseReference)),
                    description: [i.tipoDocumento || i.tipoComunicacao, i.tribunal, i.orgao, 'publicado no DJEN, sem data limite'].filter(Boolean).join(' · '),
                },
            });
            await tx.intimacao.updateMany({
                where: { id: { in: grupo.map((x) => x.id) }, prazoId: null, status: { in: ['NOVA', 'GERADA'] } },
                data: { status: 'GERADA', prazoId: prazo.id, ...revisao },
            });
            return true;
        });
        if (criou) criados++;
    } catch (err) {
        // Fica NOVA e a próxima rodada tenta de novo; os outros atos seguem
        logger.error(`[quadro] intimação ${grupo[0].djenId} não virou card:`, err);
    }
    return criados;
}

// ── Baixa automática ───────────────────────────────────────────────────────
// Expediente respondido sai das abas de "pendentes de resposta": se a leitura do tribunal foi
// completa e ele não apareceu, o card vira CUMPRIDO sem ninguém clicar em "Concluir".
// Sair do painel só prova resposta se não pode ter sido o prazo que acabou: o que vence sem
// resposta passa 10 dias em "Cujo prazo findou…" e depois some também. Então nada de baixa para
// quem estava nessa aba, nem para quem venceu há mais de 10 dias (robô parado nesse meio-tempo).
const BAIXA_ROBO = 'Robô PJe (saiu do painel)';
const JANELA_FINDOU_MS = 10 * 24 * 60 * 60 * 1000;
function saiuRespondido(e, agora) {
    if (ABA_FINDOU.test(e.situacao || '')) return false;
    return !e.dataLimite || new Date(e.dataLimite).getTime() >= agora.getTime() - JANELA_FINDOU_MS;
}

async function darBaixaNosQueSairam(tribunal, agora) {
    const sairam = await prisma.expedientePje.findMany({
        where: { tribunal, prazoId: { not: null }, vistoEm: { lt: agora } },
        select: { prazoId: true, situacao: true, dataLimite: true },
    });
    const candidatos = [...new Set(sairam.filter((e) => saiuRespondido(e, agora)).map((e) => e.prazoId))];
    if (!candidatos.length) return 0;
    // Card que junta N expedientes só fecha quando todos saíram respondidos.
    // ponytail: expediente de outro tribunal/grau no mesmo card conta como presente (card misto é raro; fica aberto)
    const todos = await prisma.expedientePje.findMany({
        where: { prazoId: { in: candidatos } },
        select: { prazoId: true, tribunal: true, vistoEm: true, situacao: true, dataLimite: true },
    });
    const presos = new Set(todos
        .filter((e) => e.tribunal !== tribunal || e.vistoEm >= agora || !saiuRespondido(e, agora))
        .map((e) => e.prazoId));
    const r = await prisma.prazo.updateMany({
        where: { id: { in: candidatos.filter((id) => !presos.has(id)) }, status: { in: ['PENDENTE', 'A_CONFIRMAR'] } },
        data: { status: 'CUMPRIDO', completedAt: agora, lastMovedBy: BAIXA_ROBO, lastMovedAt: agora },
    });
    return r.count;
}

// Rede de segurança: expediente que voltou ao painel desfaz a baixa do robô (nunca a de uma pessoa)
async function reabrirOsQueVoltaram(tribunal, agora) {
    const voltaram = await prisma.expedientePje.findMany({
        where: { tribunal, prazoId: { not: null }, vistoEm: { gte: agora } },
        select: { prazoId: true, dataLimite: true },
    });
    let n = 0;
    for (const comData of [true, false]) {
        const ids = voltaram.filter((e) => Boolean(e.dataLimite) === comData).map((e) => e.prazoId);
        if (!ids.length) continue;
        const r = await prisma.prazo.updateMany({
            where: { id: { in: ids }, status: 'CUMPRIDO', lastMovedBy: BAIXA_ROBO },
            data: { status: comData ? 'PENDENTE' : 'A_CONFIRMAR', completedAt: null, lastMovedBy: 'Robô PJe (voltou ao painel)', lastMovedAt: agora },
        });
        n += r.count;
    }
    return n;
}

// ── Gravação da leitura enviada pelo robô ──────────────────────────────────
/**
 * Grava a leitura que o robô do PC mandou — [{ tribunal, itens, incompletas } | { tribunal, erro }],
 * já validada pela rota (pjeLeituraRoutes) — e leva ao quadro. Tribunal com erro não mexe nos
 * expedientes dele. Em fila: dois envios ao mesmo tempo não intercalam upsert e baixa.
 * Devolve { resultado, prazos }, o resumo que o robô mostra.
 */
let filaGravacao = Promise.resolve();
function gravarLeitura(tribunais, { usuario } = {}) {
    filaGravacao = filaGravacao.catch(() => {}).then(() => gravar(tribunais, usuario));
    return filaGravacao;
}

async function gravar(tribunais, usuario) {
    const resultado = [];
    let atualizados = 0;
    let baixados = 0;
    let reabertos = 0;
    for (const t of tribunais) {
        if (t.erro) { resultado.push({ tribunal: t.tribunal, erro: t.erro }); continue; }
        try {
            const { itens, incompletas } = t;
            const agora = new Date();
            for (const { idExpediente, ...dados } of itens) {
                const chave = { tribunal_idExpediente: { tribunal: t.tribunal, idExpediente } };
                const antes = await prisma.expedientePje.findUnique({ where: chave, select: { prazoId: true, dataLimite: true } });
                await prisma.expedientePje.upsert({
                    where: chave,
                    create: { tribunal: t.tribunal, idExpediente, ...dados, vistoEm: agora },
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
                // Estava sem data (ciência pendente / "sem prazo") e o PJe passou a mostrar a
                // data limite: o card "a confirmar" entra no quadro — se ninguém confirmou antes à mão.
                if (antes?.prazoId && !antes.dataLimite && dados.dataLimite) {
                    const r = await prisma.prazo.updateMany({
                        where: { id: antes.prazoId, status: 'A_CONFIRMAR' },
                        data: { fatalDate: dados.dataLimite, status: 'PENDENTE' },
                    });
                    atualizados += r.count;
                }
            }
            // Só com a leitura inteira: caixa lida pela metade faria "sumir" expediente que está lá
            if (!incompletas.length && itens.length) {
                reabertos += await reabrirOsQueVoltaram(t.tribunal, agora);
                baixados += await darBaixaNosQueSairam(t.tribunal, agora);
            }
            resultado.push({
                tribunal: t.tribunal,
                expedientes: itens.length,
                // O que foi lido já está salvo acima; o erro só impede o falso "ok"
                ...(incompletas.length ? { erro: `leitura incompleta (${incompletas.join('; ')})` } : {}),
            });
        } catch (e) {
            logger.error(`[PJe] gravação de ${t.tribunal} falhou:`, e);
            resultado.push({ tribunal: t.tribunal, erro: e.message });
        }
    }
    // Mesmo com um tribunal fora do ar, o que foi lido já vai para o quadro
    let prazos;
    let erroQuadro;
    try {
        prazos = { ...(await gerarPrazosDoPje()), atualizados, baixados, reabertos };
        logger.info(`[PJe] leitura de ${usuario || '?'}: ${prazos.criados} prazo(s) criado(s), ${prazos.vinculadas} intimação(ões) vinculada(s), ${prazos.djen} card(s) do DJEN a confirmar, ${prazos.juntados} duplicado(s) juntado(s), ${atualizados} data(s) atualizada(s), ${baixados} cumprido(s) por sair do painel, ${reabertos} reaberto(s)`);
    } catch (e) {
        erroQuadro = e;
        resultado.push({ tribunal: 'Quadro de prazos', erro: e.message });
    }
    // Fica no banco para o painel avisar (o robô roda sem ninguém olhando)
    await recordHeartbeat({
        pjeLastAttemptAt: new Date(),
        pjeLastBy: usuario || null,
        pjeLastFalhas: resultado.filter((t) => t.erro).map(({ tribunal, erro }) => ({ tribunal, erro: String(erro).slice(0, 300) })),
    });
    if (erroQuadro) throw erroQuadro;
    return { resultado, prazos };
}

module.exports = {
    gravarLeitura, gerarPrazosDoPje, soDigitos, formatarCnj, melhorExpediente, saiuRespondido,
};
