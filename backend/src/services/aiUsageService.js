const logger = require('../infra/logger');
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '../../config/ai_usage.json');

function readUsage() {
    try {
        if (fs.existsSync(FILE_PATH)) {
            return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
        }
    } catch (e) { }
    return { date: new Date().toISOString().split('T')[0], requests: 0, tokens: 0 };
}

function writeUsage(data) {
    try {
        const dir = path.dirname(FILE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(FILE_PATH, JSON.stringify(data), 'utf8');
    } catch(e) {
        logger.error("Erro ao salvar ai_usage.json", e);
    }
}

function logUsage(tokens) {
    const today = new Date().toISOString().split('T')[0];
    let data = readUsage();
    if (data.date !== today) {
        data = { date: today, requests: 0, tokens: 0 };
    }
    data.requests += 1;
    data.tokens += (tokens || 0);
    writeUsage(data);
}

function getUsage() {
    const today = new Date().toISOString().split('T')[0];
    let data = readUsage();
    if (data.date !== today) {
        data = { date: today, requests: 0, tokens: 0 };
        writeUsage(data);
    }
    return data;
}

module.exports = { logUsage, getUsage };
