const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

// Só contas Google do escritório. A tela de login também filtra, mas quem vale é o servidor.
const DOMINIO = '@jvo.adv.br';

// verifyIdToken só precisa do projectId (chaves públicas do Google) — sem service account.
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'login-impugancao';

/**
 * Lê o ID token do Firebase em `Authorization: Bearer <token>` e devolve o e-mail
 * verificado, ou { status, error } para a rota responder. Nunca confia em header
 * de e-mail enviado pelo cliente.
 */
async function emailDoToken(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return { status: 401, error: 'Sessão ausente. Faça login novamente.' };
    let decoded;
    try {
        decoded = await auth.verificarToken(m[1]);
    } catch {
        return { status: 401, error: 'Sessão inválida ou expirada. Faça login novamente.' };
    }
    const email = String(decoded.email || '').toLowerCase();
    if (!decoded.email_verified || !email.endsWith(DOMINIO)) {
        return { status: 403, error: `Acesso exclusivo para contas ${DOMINIO}.` };
    }
    return { email };
}

const auth = {
    // Propriedade de objeto (não função solta) para os testes trocarem o verificador.
    verificarToken: (token) => {
        if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
        return getAuth().verifyIdToken(token);
    },
    emailDoToken,
};

module.exports = auth;
