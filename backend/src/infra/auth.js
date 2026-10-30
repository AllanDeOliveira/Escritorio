// Login próprio: e-mail + senha, sessão em cookie httpOnly (mesmo desenho do Umbler Talk).
// Sem Firebase: o túnel do Cloudflare muda de endereço e o Firebase exigia cadastrar cada um.
const crypto = require('crypto');
const { promisify } = require('util');
const prisma = require('./prismaClient');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'jvo_sessao';
const DIA_MS = 86_400_000;
const DIAS_SESSAO = 30;

// scrypt da biblioteca padrão com os parâmetros mínimos da OWASP (N=2^17, r=8, p=1).
// Formato: "scrypt$<N>$<r>$<p>$<sal hex>$<hash hex>" — os parâmetros vão junto para poder subir depois.
const PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

async function hashSenha(senha) {
    const sal = crypto.randomBytes(16);
    const h = await scrypt(String(senha), sal, 64, PARAMS);
    return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${sal.toString('hex')}$${h.toString('hex')}`;
}

async function verificarSenha(hash, senha) {
    const [alg, N, r, p, sal, esperado] = String(hash || '').split('$');
    if (alg !== 'scrypt' || !esperado) return false;
    try {
        const h = await scrypt(String(senha), Buffer.from(sal, 'hex'), 64, { N: +N, r: +r, p: +p, maxmem: PARAMS.maxmem });
        return crypto.timingSafeEqual(h, Buffer.from(esperado, 'hex'));
    } catch {
        return false;
    }
}

const idDoToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const expira = () => new Date(Date.now() + DIAS_SESSAO * DIA_MS);

/** Cria a sessão e devolve o token cru (vai só para o cookie; o banco guarda o SHA-256). */
async function criarSessao(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await prisma.sessao.create({ data: { id: idDoToken(token), userId, expiresAt: expira() } });
    return token;
}

/** Usuário dono da sessão, ou null (sem token, expirada, usuário desativado). Renova a validade com o uso. */
async function usuarioDaSessao(token) {
    if (!token) return null;
    const id = idDoToken(token);
    const s = await prisma.sessao.findUnique({ where: { id }, include: { user: true } });
    if (!s || s.expiresAt <= new Date() || !s.user.ativo) return null;
    // ponytail: renova no máximo 1x por hora (não a cada requisição)
    if (s.expiresAt.getTime() < expira().getTime() - 3_600_000) {
        await prisma.sessao.update({ where: { id }, data: { expiresAt: expira() } });
    }
    return s.user;
}

const encerrarSessao = (token) => prisma.sessao.deleteMany({ where: { id: idDoToken(token) } });

// Token do robô do PJe (robo-pje/ no PC com o certificado): mesmo esquema das sessões —
// o token cru vai só para o PC; o banco guarda o SHA-256. Só vale nas rotas do robô (requireRobo).
const gerarTokenRobo = () => `jvo_robo_${crypto.randomBytes(32).toString('base64url')}`;

async function usuarioDoTokenRobo(token) {
    if (!token) return null;
    const t = await prisma.tokenRobo.findUnique({ where: { hash: idDoToken(token) }, include: { user: true } });
    if (!t || t.revogadoEm || !t.user.ativo) return null;
    await prisma.tokenRobo.update({ where: { id: t.id }, data: { ultimoUsoEm: new Date() } });
    return t.user;
}

/** Valor do cookie de sessão (sem dependência: o cabeçalho é "a=1; b=2"). */
function lerCookie(req) {
    for (const par of String(req.headers.cookie || '').split(';')) {
        const i = par.indexOf('=');
        if (i > 0 && par.slice(0, i).trim() === COOKIE) return decodeURIComponent(par.slice(i + 1).trim());
    }
    return null;
}

function gravarCookie(req, res, token) {
    res.cookie(COOKIE, token, {
        httpOnly: true, // o JavaScript da página nunca vê o token
        sameSite: 'lax', // outro site não manda o cookie em POST/PUT/DELETE
        secure: req.secure, // https pelo túnel (trust proxy no index.js); http em localhost
        path: '/',
        maxAge: DIAS_SESSAO * DIA_MS, // a validade real é a do banco (renovada com o uso)
    });
}

const apagarCookie = (res) => res.clearCookie(COOKIE, { path: '/' });

/** Usuário sem o hash da senha — é o que pode ir para o navegador. */
function usuarioPublico(u) {
    const { passwordHash: _hash, ...resto } = u;
    return resto;
}

module.exports = {
    hashSenha, verificarSenha, criarSessao, usuarioDaSessao, encerrarSessao, idDoToken, gerarTokenRobo, usuarioDoTokenRobo,
    lerCookie, gravarCookie, apagarCookie, usuarioPublico, COOKIE,
};
