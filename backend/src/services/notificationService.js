const logger = require('../infra/logger');
const prisma = require('../infra/prismaClient');
const { sendDirectMessage } = require('./whatsappService.js');
const { getGenAI } = require('../infra/genai');
const { getProcesso: buscarProcessoDatajud } = require('./tribunalService.js');
const ai = getGenAI();

const runDailyNotifications = async () => {
    logger.info('Iniciando Varredura Inteligente Datajud para WhatsApp...');

    try {
        const settings = await prisma.systemSettings.findFirst();

        if (!settings || !settings.whatsappGroupId) {
            logger.info('Varredura abortada: Nenhum grupo de WhatsApp configurado.');
            return;
        }

        const processos = await prisma.lawsuit.findMany({ where: { status: 'ATIVO' } });

        if (processos.length === 0) {
            logger.info('Nenhum processo monitorado no DB.');
            return;
        }

        const updates = [];

        // Busca batch limitando a concorrência
        for (const p of processos) {
            logger.info(`Buscando Datajud para ${p.caseNumber}...`);
            try {
                const datajudResponse = await buscarProcessoDatajud(p.caseNumber.replace(/\D/g, ''));

                // Lógica simples: se o Datajud achou movimentações, a gente pega a mais recente.
                // Para fim de teste CRM e notificação, vamos pegar o último evento da timeline do Datajud processado
                if (datajudResponse.sucesso && datajudResponse.dados && datajudResponse.dados.movimentos) {
                    const mov = datajudResponse.dados.movimentos[0]; // mais recente

                    if (mov) {
                        updates.push({
                            cnj: p.caseNumber,
                            tribunal: p.court,
                            acao: p.actionType,
                            ultimaMovimentacao: mov.nome,
                            dataMovimento: mov.dataHora || 'Data desconhecida'
                        });
                    }
                }
            } catch (e) {
                logger.error(`Falha no monitoramento do CNJ ${p.caseNumber}`);
            }

            // Delay 1.5s entre requisições para evitar WAF Block no governo
            await new Promise(r => setTimeout(r, 1500));
        }

        if (updates.length > 0) {
            const prompt = `Você é um robô do Central JVO Monitoramento Jurídico.
Abaixo estão as movimentações processuais detectadas HOJE pelo Datajud (CNJ).
Crie uma mensagem muito bem humorada e dinâmica em português para o grupo do WhatsApp de advogados.
Obrigatório começar estruturalmente com: @todos 🚨 ATUALIZAÇÃO DATAJUD

Dados Coletados (Último andamento de cada processo ativo):
${JSON.stringify(updates, null, 2)}

Regras RIGOROSAS:
1. Resuma as movimentações processuais em itens de lista claros usando o emoji 🔹 correspondente da gravidade.
2. Não use o caractere asterisco (*) isolado para bullet points para não bugar o WhatsApp. Para negrito, junte o asterisco na palavra. Exemplo: *Processo X*
3. Formato encorajado: 
🔹 *${updates[0]?.cnj}* | ${updates[0]?.ultimaMovimentacao}
4. Faça fechamento amigável lembrando que estes processos foram extraídos diretamente da API do Governo.`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents: prompt
            });

            await sendDirectMessage(settings.whatsappGroupId, response.text);
            logger.info('Notificação Datajud enviada via WhatsApp!');
        }

    } catch (error) {
        logger.error('ERRO NA VARREDURA DATAJUD:', error);
    }
};

module.exports = { runDailyNotifications };
