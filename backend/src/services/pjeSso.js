/**
 * Login no PJe (SSO PDPJ / Keycloak) com certificado A1 — sem PJeOffice instalado.
 *
 * O botão "Certificado digital" do SSO chama o PJeOffice local com a tarefa
 * `sso.autenticador`: ele assina a frase-desafio (`mensagem`) com o certificado e
 * envia a assinatura para `<servidor>/pjeoffice-rest`. Depois o navegador submete
 * o formulário de login com `pjeoffice-code = token`. Aqui fazemos o mesmo papel
 * do PJeOffice, assinando com o .pfx.
 *
 * ⚠️ Só autentica. Nada aqui dá ciência nem peticiona (ver guarda em mniService.js).
 *
 * O SSO exige 2FA (TOTP) para usuários externos. O robô gera o código a partir
 * da chave secreta do autenticador (a mesma do QR code do Google Authenticator).
 *
 * Config (backend/.env): MNI_CERT_PATH, MNI_CERT_SENHA (mesmo certificado do MNI)
 *                        PJE_TOTP_SECRET (chave base32 do autenticador)
 *                        PJE_URL (opcional; padrão TJMT 1º grau)
 */
const fs = require('fs');
const crypto = require('crypto');
const forge = require('node-forge');

const PJE_URL_PADRAO = 'https://pje.tjmt.jus.br/pje';

// ── Certificado ────────────────────────────────────────────────────────────
function lerPfx(pfxBuffer, senha) {
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfxBuffer.toString('binary')), senha);
    const chaves = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]
        || p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
    if (!chaves.length) throw new Error('PFX sem chave privada');
    const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map((b) => b.cert);

    const chavePem = forge.pki.privateKeyToPem(chaves[0].key);
    const pubDaChave = forge.pki.setRsaPublicKey(chaves[0].key.n, chaves[0].key.e);
    const titular = certs.find((c) => forge.pki.publicKeyToPem(c.publicKey) === forge.pki.publicKeyToPem(pubDaChave));
    if (!titular) throw new Error('PFX sem o certificado do titular');

    // Cadeia titular → AC raiz, seguindo o emissor
    const cadeia = [titular];
    for (let atual = titular; ;) {
        const emissor = certs.find((c) => c !== atual && !cadeia.includes(c) && atual.isIssuer(c));
        if (!emissor) break;
        cadeia.push(emissor);
        atual = emissor;
    }
    return { chavePem, cadeia };
}

// PkiPath (RFC/Java CertPath "PkiPath"): SEQUENCE OF Certificate, da raiz para o titular
function pkiPathBase64(cadeia) {
    const seq = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true,
        [...cadeia].reverse().map((c) => forge.pki.certificateToAsn1(c)));
    return forge.util.encode64(forge.asn1.toDer(seq).getBytes());
}

// PJeOffice usa MD5withRSA quando o SSO não manda `algoritmoAssinatura` (caso atual)
function assinarDesafio(mensagem, chavePem, algoritmo = 'md5') {
    return crypto.sign(algoritmo, Buffer.from(mensagem, 'utf8'), chavePem).toString('base64');
}

// ── 2FA: TOTP (RFC 6238, SHA-1, 30 s, 6 dígitos — padrão do Google Authenticator)
function base32(str) {
    const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const ch of str.toUpperCase().replace(/[\s=]/g, '')) {
        const v = alfabeto.indexOf(ch);
        if (v < 0) throw new Error('PJE_TOTP_SECRET inválido (não é base32)');
        bits += v.toString(2).padStart(5, '0');
    }
    if (bits.length < 8) throw new Error('PJE_TOTP_SECRET inválido (curto demais)');
    return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}

function totp(segredoBase32, agoraMs = Date.now()) {
    const contador = Buffer.alloc(8);
    contador.writeBigUInt64BE(BigInt(Math.floor(agoraMs / 30000)));
    const h = crypto.createHmac('sha1', base32(segredoBase32)).update(contador).digest();
    const o = h[h.length - 1] & 0xf;
    return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}

// ── HTTP com cookies por host ──────────────────────────────────────────────
// ponytail: jar por hostname, ignora path/domain — basta para uma sessão de login curta.
// Expiração NÃO pode ser ignorada: o PJe apaga OAuth_Token_Request_State/JSESSIONID com
// Max-Age=0 e, se reenviarmos o cookie vazio, o 2º grau derruba a sessão e volta ao login.
function criarCliente() {
    const jar = new Map();
    const cookieDe = (host) => [...(jar.get(host) || new Map())].map(([k, v]) => `${k}=${v}`).join('; ');
    const guardar = (host, res) => {
        const m = jar.get(host) || new Map();
        for (const c of res.headers.getSetCookie()) {
            const [par, ...attrs] = c.split(';');
            const i = par.indexOf('=');
            const nome = par.slice(0, i).trim();
            const valor = par.slice(i + 1).trim();
            const expira = attrs.map((a) => a.trim().toLowerCase());
            const apagado = !valor || expira.includes('max-age=0')
                || expira.some((a) => a.startsWith('expires=') && Date.parse(a.slice(8)) < Date.now());
            if (apagado) m.delete(nome); else m.set(nome, valor);
        }
        jar.set(host, m);
    };

    // Segue redirects manualmente para capturar cookies de cada salto (SSO ↔ PJe)
    async function ir(url, { method = 'GET', headers = {}, body } = {}) {
        for (let saltos = 0; saltos < 15; saltos++) {
            const host = new URL(url).hostname;
            const res = await fetch(url, {
                method, body, redirect: 'manual', signal: AbortSignal.timeout(90000),
                headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookieDe(host), ...headers },
            });
            guardar(host, res);
            const loc = res.headers.get('location');
            if (res.status >= 300 && res.status < 400 && loc) {
                url = new URL(loc, url).toString();
                method = 'GET'; body = undefined; headers = {};
                continue;
            }
            return { url, status: res.status, texto: await res.text() };
        }
        throw new Error('redirects demais');
    }
    return { ir, cookieDe };
}

const desescapar = (s) => s.replace(/&amp;/g, '&');

// ── Login ──────────────────────────────────────────────────────────────────
// Último TOTP enviado, do módulo: dois logins seguidos no mesmo SSO (1º e 2º grau do TJMT,
// ou o fallback intranet→internet) não podem repetir o código — o Keycloak recusa reuso.
let ultimoOtp = null;

async function loginCertificado({
    pjeUrl = process.env.PJE_URL || PJE_URL_PADRAO,
    pfx = fs.readFileSync(process.env.MNI_CERT_PATH),
    senhaPfx = process.env.MNI_CERT_SENHA,
    segredoTotp = process.env.PJE_TOTP_SECRET,
} = {}) {
    const { chavePem, cadeia } = lerPfx(pfx, senhaPfx);
    const cliente = criarCliente();

    const telaDeLogin = (p) => /id="loginForm"/.test(p.texto) && /autenticar\(/.test(p.texto);

    // Uma rodada do que o navegador + PJeOffice fazem a partir da tela de login do SSO
    async function entrar(pagina) {
        const action = pagina.texto.match(/id="loginForm"[^>]*action="([^"]+)"/);
        const desafio = pagina.texto.match(/autenticar\('([^']*)',\s*'([^']*)'\)/);
        if (!action || !desafio) throw new Error(`Tela de login do SSO não reconhecida (${pagina.url})`);
        const mensagem = desafio[2];
        const token = crypto.randomUUID();

        // 2. O que o PJeOffice faz: envia a assinatura do desafio ao SSO
        const servidor = `${new URL(pagina.url).origin}/auth/realms/pje`;
        const envio = await cliente.ir(`${servidor}/pjeoffice-rest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                certChain: pkiPathBase64(cadeia),
                uuid: token,
                mensagem,
                assinatura: assinarDesafio(mensagem, chavePem),
            }),
        });
        if (envio.status >= 400) throw new Error(`SSO recusou a assinatura (HTTP ${envio.status}): ${envio.texto.slice(0, 300)}`);

        // 3. Submete o formulário como o navegador faria após o PJeOffice responder
        let final = await cliente.ir(desescapar(action[1]), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ username: '', password: '', 'pjeoffice-code': token, phrase: '' }).toString(),
        });

        // 4. Segundo fator (o SSO recusa o mesmo código duas vezes: espera a próxima janela de 30 s)
        const formOtp = final.texto.match(/id="kc-otp-login-form"[^>]*action="([^"]+)"/);
        if (formOtp) {
            if (!segredoTotp) throw new Error('SSO pediu 2FA e PJE_TOTP_SECRET não está configurado');
            while (totp(segredoTotp) === ultimoOtp) await new Promise((r) => setTimeout(r, 1000));
            ultimoOtp = totp(segredoTotp);
            final = await cliente.ir(desescapar(formOtp[1]), {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ otp: ultimoOtp, login: 'Validar' }).toString(),
            });
        }
        return { final, servidor };
    }

    // 1. Página de login do SSO (via redirect do PJe). O TJMT 2º grau devolve a tela de
    // login uma segunda vez depois do primeiro acesso (o robô de peticionamento também
    // clica duas vezes) — então repete a rodada, no máximo mais uma vez.
    let { final, servidor } = await entrar(await cliente.ir(`${pjeUrl}/login.seam`));
    if (new URL(final.url).hostname === new URL(servidor).hostname && telaDeLogin(final)) {
        ({ final, servidor } = await entrar(final));
    }
    const host = new URL(final.url).hostname;
    if (host === new URL(servidor).hostname) {
        const otp = /name="(?:otp|totp)"|id="(?:otp|totp)"/i.test(final.texto);
        const erro = final.texto.match(/class="[^"]*(?:alert|kc-feedback)[^"]*"[^>]*>([\s\S]{0,300}?)</i);
        const e = new Error(otp ? 'SSO pediu segundo fator (2FA)' : `Login não concluído: ${erro ? erro[1].trim() : final.url}`);
        e.pagina = final;
        throw e;
    }
    return { cliente, pjeUrl, paginaInicial: final };
}

module.exports = { loginCertificado, lerPfx, pkiPathBase64, assinarDesafio, totp };
