const logger = require('../infra/logger');
const pkg = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Client, LocalAuth } = pkg;

const state = {
  qrCodeUrl: null,
  status: 'DISCONNECTED' // DISCONNECTED, WAITING_QR, CONNECTED
};

// Vamos encontrar o Chrome VERDADEIRO da máquina do usuário para burlar o block da Meta
const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe'
];

let realChromePath = null;
for (const p of chromePaths) {
    if (fs.existsSync(p)) {
        realChromePath = p;
        logger.info(`Chrome encontrado em: ${realChromePath}`);
        break;
    }
}
if (!realChromePath) {
    logger.warn("AVISO: Chrome não encontrado nos caminhos padrão. O WhatsApp pode falhar ao iniciar.");
}

// Configurar armazenamento local da sessão no diretório apropriado do backend
const authPath = path.join(__dirname, '..', '.wwebjs_auth');

let client = null;

const createClient = () => {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: authPath }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },
    puppeteer: {
      headless: true, 
      executablePath: realChromePath,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--hide-scrollbars',
        '--disable-notifications',
        '--disable-extensions'
      ]
    }
  });

  client.on('qr', async (qr) => {
    logger.info('QR CODE WhatsApp GERADO!');
    try {
      state.qrCodeUrl = await qrcode.toDataURL(qr);
      state.status = 'WAITING_QR';
    } catch (err) {
      logger.error('Erro ao gerar imagem QR', err);
    }
  });

  client.on('ready', () => {
    logger.info('WhatsApp Conectado de VERDADE com sucesso!');
    state.status = 'CONNECTED';
    state.qrCodeUrl = null;
  });

  client.on('disconnected', () => {
    logger.info('WhatsApp Desconectado!');
    state.status = 'DISCONNECTED';
    state.qrCodeUrl = null;
  });
};

// Inicializa a primeira vez
createClient();

const initializeWhatsApp = (retries = 3) => {
  logger.info(`Iniciando Robô do WhatsApp silenciosamente em background... (Tentativas: ${4 - retries}/3)`);
  
  // Limpeza preventiva do SingletonLock para evitar erro "browser is already running"
  try {
    const lockFilePath = path.join(authPath, 'session', 'SingletonLock');
    if (fs.existsSync(lockFilePath)) {
      logger.info("Detectado SingletonLock remanescente. Removendo antes de iniciar...");
      fs.unlinkSync(lockFilePath);
      logger.info("SingletonLock removido com sucesso.");
    }
  } catch (e) {
    logger.error("Não foi possível remover o SingletonLock preventivamente.", e.message);
  }

  if (!client) createClient();
  
  client.initialize().catch(async (err) => {
    logger.error("Erro ao inicializar WhatsApp:", err.message);
    
    // Se ainda der erro de lock ou diretório, tentamos limpar novamente
    if (err.message.includes('browser is already running') || err.message.includes('userDataDir')) {
      logger.info("Lock do navegador detectado no catch. Tentando limpeza forçada...");
      try {
        const lockFilePath = path.join(authPath, 'session', 'SingletonLock');
        if (fs.existsSync(lockFilePath)) fs.unlinkSync(lockFilePath);
      } catch (e) {}
    }

    // Erro de contexto destruído ou lock travado (vamos tentar de novo)
    if (retries > 0 && (
        err.message.includes('Execution context was destroyed') || 
        err.message.includes('Navigating to') ||
        err.message.includes('browser is already running') ||
        err.message.includes('userDataDir')
    )) {
      logger.info("Tentando inicializar novamente em 5 segundos...");
      state.status = 'DISCONNECTED';
      await new Promise(resolve => setTimeout(resolve, 5000));
      return initializeWhatsApp(retries - 1);
    }
    
    logger.error("Erro fatal ao inicializar WhatsApp", err);
    state.status = 'DISCONNECTED';
  });
};

const getGroups = async () => {
  if (state.status !== 'CONNECTED' || !client) return [];
  try {
    const chats = await client.getChats();
    return chats.filter(c => c.isGroup).map(g => ({
      id: g.id._serialized,
      name: g.name
    }));
  } catch (error) {
    logger.error("Erro ao buscar grupos:", error);
    return [];
  }
};

const sendDirectMessage = async (jid, text) => {
  if (state.status !== 'CONNECTED' || !client) throw new Error("WhatsApp não está conectado.");
  try {
    let options = {};
    
    // Suporte a @todos (@all)
    if (text.includes('@todos') && jid.endsWith('@g.us')) {
      const chat = await client.getChatById(jid);
      if (chat.isGroup) {
        options.mentions = chat.participants.map(p => p.id._serialized);
      }
    }

    await client.sendMessage(jid, text, options);
    logger.info(`Mensagem enviada com sucesso para ${jid} (mentions: ${options.mentions ? options.mentions.length : 0})`);
    return true;
  } catch (error) {
    logger.error(`Erro ao enviar mensagem para ${jid}:`, error);
    throw error;
  }
};

const logoutWhatsApp = async () => {
  try {
    logger.info('Tentando desconectar o WhatsApp de forma agressiva...');
    state.status = 'LOADING'; // Feedback rápido pro usuário
    
    // Tenta deslogar e destruir
    if (client) {
      try {
        await client.logout();
      } catch (e) {
        logger.error('Erro no logout suave, forçando destruição...');
      }
      try {
        await client.destroy();
      } catch (e) {}
    }
    
    // Apaga a pasta de sessão para garantir o QR code novo
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }

    state.status = 'DISCONNECTED';
    state.qrCodeUrl = null;
    client = null;
    
    logger.info('Sessão limpa. Reconstruindo cliente...');
    createClient();
    setTimeout(() => {
      initializeWhatsApp();
    }, 1000);
    return true;
  } catch (error) {
    logger.error('Erro ao desconectar WhatsApp:', error);
    throw error;
  }
};

module.exports = {
  state,
  get client() { return client; }, // Accessor to return the current client reference
  initializeWhatsApp,
  getGroups,
  sendDirectMessage,
  logoutWhatsApp
};
