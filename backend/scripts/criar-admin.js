// Cria (ou atualiza) um administrador com senha — é assim que o primeiro login nasce.
// Uso (na pasta backend):  npm run criar-admin -- voce@jvo.adv.br "Seu Nome"
// A senha é pedida no terminal, sem aparecer na tela. Rodar de novo com o mesmo e-mail troca a senha.
const readline = require('readline');
const prisma = require('../src/infra/prismaClient');
const auth = require('../src/infra/auth');

const [email, ...nome] = process.argv.slice(2);
if (!email || !email.includes('@') || !nome.length) {
    console.error('Uso: npm run criar-admin -- email@jvo.adv.br "Nome Completo"');
    process.exit(1);
}

// Um leitor só, com as linhas numa fila (iterador): nenhuma resposta se perde, nem com a entrada
// chegando toda de uma vez. O eco do terminal fica mudo; a pergunta é escrita direto na tela.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
rl._writeToOutput = () => {}; // não ecoa o que é digitado
const linhas = rl[Symbol.asyncIterator]();
async function perguntarSenha(pergunta) {
    process.stdout.write(pergunta);
    const { value } = await linhas.next();
    process.stdout.write('\n');
    return value ?? '';
}

(async () => {
    const senha = await perguntarSenha('Senha (mín. 8 caracteres): ');
    if (senha.length < 8) throw new Error('Senha curta demais.');
    if (senha !== await perguntarSenha('Repita a senha: ')) throw new Error('As senhas não conferem.');
    rl.close();
    const dados = { name: nome.join(' '), role: 'admin', ativo: true, passwordHash: await auth.hashSenha(senha) };
    const u = await prisma.user.upsert({
        where: { email: email.trim().toLowerCase() },
        update: dados,
        create: { email: email.trim().toLowerCase(), ...dados },
    });
    console.log(`Pronto: ${u.email} é administrador e já pode entrar.`);
})()
    .catch((e) => { console.error(`Erro: ${e.message}`); process.exitCode = 1; })
    .finally(() => { rl.close(); return prisma.$disconnect(); });
