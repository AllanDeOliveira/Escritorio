import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { totp, criarCliente, loginPje } = require('./pjeSso');

// SSO simulado (mesmo HTML que o sso.cloud.pje.jus.br serve, enxuto): tela de login → 2FA → painel
describe('loginPje por CPF + senha (sem certificado)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('manda o formulário como o navegador, nunca chama a assinatura do PJeOffice, passa pelo 2FA e chega no PJe', async () => {
        const chamadas = [];
        const sso = 'https://sso.cloud.pje.jus.br/auth/realms/pje';
        vi.stubGlobal('fetch', vi.fn(async (url, init) => {
            chamadas.push({ url, metodo: init.method, corpo: init.body });
            if (url.endsWith('/pje/login.seam')) return new Response(null, { status: 302, headers: { location: `${sso}/protocol/openid-connect/auth?client_id=pje-trf1-1g` } });
            if (url.includes('/openid-connect/auth')) {
                return new Response(`<form id="loginForm" onsubmit="x" action="${sso}/login-actions/authenticate?session_code=abc&amp;tab_id=1">
                    <input name="username"><input name="password"><input type="hidden" name="pjeoffice-code" value="">
                    <input type="button" onclick="autenticar('cod', 'desafio')"></form>`, { status: 200 });
            }
            if (url.includes('/login-actions/authenticate')) return new Response(`<form id="kc-otp-login-form" action="${sso}/login-actions/otp?x=1"><input name="otp"></form>`, { status: 200 });
            if (url.includes('/login-actions/otp')) return new Response(null, { status: 302, headers: { location: 'https://pje1g.trf1.jus.br/pje/Painel/painel_usuario/advogado.seam' } });
            if (url.includes('advogado.seam')) return new Response('<html>Painel do Advogado</html>', { status: 200 });
            return new Response('inesperado', { status: 404 });
        }));

        const r = await loginPje({ pjeUrl: 'https://pje1g.trf1.jus.br/pje', cpf: '123.456.789-09', senha: 'S3nh@ com espaço', segredoTotp: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' });

        expect(r.paginaInicial.url).toContain('advogado.seam');
        expect(chamadas.some((c) => c.url.includes('pjeoffice-rest'))).toBe(false); // nada de certificado
        const form = new URLSearchParams(chamadas.find((c) => c.url.includes('/login-actions/authenticate')).corpo);
        expect(Object.fromEntries(form)).toEqual({ username: '12345678909', password: 'S3nh@ com espaço', login: 'Entrar', 'pjeoffice-code': '', phrase: '' });
        expect(new URLSearchParams(chamadas.find((c) => c.url.includes('/login-actions/otp')).corpo).get('otp')).toMatch(/^\d{6}$/);
    });

    it('CPF sem senha: falha antes de tocar no PJe', async () => {
        const f = vi.fn();
        vi.stubGlobal('fetch', f);
        await expect(loginPje({ cpf: '12345678909' })).rejects.toThrow(/Credenciais do PJe não informadas/);
        expect(f).not.toHaveBeenCalled();
    });
});

describe('criarCliente', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('não manda Cookie vazio (o firewall do TJMT responde 403) e manda o cookie recebido no salto seguinte', async () => {
        const cookies = [];
        vi.stubGlobal('fetch', vi.fn(async (url, init) => {
            cookies.push(init.headers.Cookie);
            return url.endsWith('/login.seam')
                ? new Response(null, { status: 302, headers: { location: '/sso', 'set-cookie': 'JSESSIONID=abc; Path=/' } })
                : new Response('ok', { status: 200 });
        }));
        const r = await criarCliente().ir('https://pje.tjmt.jus.br/pje/login.seam');
        expect(r.status).toBe(200);
        expect(cookies).toEqual([undefined, 'JSESSIONID=abc']);
    });

    it('não segue redirect para fora de https://*.jus.br (a credencial não sai do PC)', async () => {
        const urls = [];
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            urls.push(url);
            return new Response(null, { status: 302, headers: { location: 'https://jus.br.atacante.com/coleta' } });
        }));
        await expect(criarCliente().ir('https://pje.tjmt.jus.br/pje/login.seam')).rejects.toThrow(/fora do PJe/);
        await expect(criarCliente().ir('http://pje.tjmt.jus.br/pje/login.seam')).rejects.toThrow(/fora do PJe/);
        expect(urls).toEqual(['https://pje.tjmt.jus.br/pje/login.seam']);
    });
});

describe('totp', () => {
    // Vetores da RFC 6238 (SHA-1, segredo "12345678901234567890"), últimos 6 dígitos
    const segredo = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    it('bate com a RFC 6238', () => {
        expect(totp(segredo, 59000)).toBe('287082');
        expect(totp(segredo, 1111111109000)).toBe('081804');
        expect(totp(segredo, 2000000000000)).toBe('279037');
    });

    it('aceita espaços/minúsculas e rejeita chave inválida', () => {
        expect(totp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59000)).toBe('287082');
        expect(() => totp('não-base32!', 0)).toThrow();
    });
});
