const { GoogleGenAI } = require('@google/genai');

let aiInstance = null;

function getGenAI() {
    if (!aiInstance) {
        aiInstance = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: { timeout: 300000 }
        });
    }
    return aiInstance;
}

module.exports = { getGenAI };
