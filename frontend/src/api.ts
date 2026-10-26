// Endereço do backend — um só lugar; antes cada tela lia uma variável diferente.
// Build de produção é servido pelo próprio backend (túnel do Cloudflare): API no mesmo endereço ('').
export const API = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3001');

// Usuário logado como o backend devolve (/api/auth/me) — nunca traz o hash da senha
export interface Usuario {
  id: string;
  email: string;
  name?: string | null;
  role: 'admin' | 'member' | string;
  areas?: string[];
  noQuadro?: boolean;
  ativo?: boolean;
}

// fetch para o backend com o cookie de sessão (httpOnly: o JavaScript nem vê o token).
// 401 = sessão acabou (expirou, foi desativada ou a senha mudou em outro lugar): o App volta para o login.
export async function apiFetch(input: string, init: RequestInit = {}) {
  const r = await fetch(input, { ...init, credentials: 'include' });
  if (r.status === 401 && !input.endsWith('/api/auth/login')) window.dispatchEvent(new Event('sessao-expirada'));
  return r;
}
