const pino = require('pino');

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    hooks: {
        // O código chama logger.error('msg:', err) (estilo console); o pino trataria
        // `err` como argumento de formatação e o descartaria. Aqui o erro vira { err }
        // para a mensagem e a stack aparecerem no log.
        logMethod(args, method) {
            const i = args.findIndex((a) => a instanceof Error);
            if (typeof args[0] === 'string' && i > 0) {
                return method.call(this, { err: args[i] }, args.filter((_, j) => j !== i).join(' '));
            }
            return method.apply(this, args);
        },
    },
});

module.exports = logger;
