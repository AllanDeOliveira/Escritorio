const fs = require('fs');
const path = require('path');
const logger = require('../infra/logger');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
const CONFIG_FILE = path.join(CONFIG_DIR, 'escritorio.json');

const CONFIG_DEFAULT = { nomeEscritorio: '' };

let cachedConfig = null;

function lerConfig() {
    if (cachedConfig) return cachedConfig;
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            cachedConfig = { ...CONFIG_DEFAULT, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
            return cachedConfig;
        }
    } catch (e) {
        logger.error('Erro ao ler escritorio.json:', e);
    }
    cachedConfig = { ...CONFIG_DEFAULT };
    return cachedConfig;
}

function salvarConfig(novosDados) {
    cachedConfig = { ...lerConfig(), ...novosDados };
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(cachedConfig, null, 2), 'utf8');
    } catch (e) {
        logger.error('Erro ao salvar escritorio.json:', e);
        throw e;
    }
    return cachedConfig;
}

module.exports = { lerConfig, salvarConfig, CONFIG_DEFAULT };
