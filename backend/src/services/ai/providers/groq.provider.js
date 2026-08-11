import Groq from 'groq-sdk';
import 'dotenv/config';

let client = null;

const getClient = () => {
    if (!client) {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) throw new Error('GROQ_API_KEY no configurada');
        client = new Groq({ apiKey });
    }
    return client;
};

// Modelos disponibles en Groq Free Tier
const MODELS = {
    fast: 'llama-3.1-8b-instant',       // 14,400 RPD, 30 RPM
    versatile: 'llama-3.3-70b-versatile', // ~1,000 RPD
    whisper: 'whisper-large-v3',
    whisperTurbo: 'whisper-large-v3-turbo'
};

/**
 * Chat completion con texto
 * @param {Array} messages - Mensajes en formato OpenAI [{role, content}]
 * @param {Object} options - { model, temperature, maxTokens }
 * @returns {string} Contenido de la respuesta
 */
export const chat = async (messages, options = {}) => {
    const groq = getClient();
    const completion = await groq.chat.completions.create({
        messages,
        model: options.model || MODELS.versatile,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens || 2048
    });
    return completion.choices[0].message.content;
};

/**
 * Chat completion con respuesta JSON
 * @param {Array} messages - Mensajes en formato OpenAI [{role, content}]
 * @param {Object} options - { model, temperature, maxTokens }
 * @returns {Object} JSON parseado
 */
export const chatJSON = async (messages, options = {}) => {
    const groq = getClient();
    const completion = await groq.chat.completions.create({
        messages,
        model: options.model || MODELS.versatile,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens || 2048,
        response_format: { type: 'json_object' }
    });
    const content = completion.choices[0].message.content;
    return JSON.parse(content);
};

/**
 * Transcripción de audio con Whisper
 * @param {Buffer} audioBuffer - Buffer del archivo de audio
 * @param {string} mimeType - Tipo MIME del audio
 * @returns {string} Texto transcrito
 */
export const transcribe = async (audioBuffer, mimeType = 'audio/webm', options = {}) => {
    const groq = getClient();
    const m = (mimeType || '').toLowerCase();
    const ext = m.includes('mp4') || m.includes('aac') ? 'm4a'
        : m.includes('wav') ? 'wav'
        : m.includes('ogg') ? 'ogg'
        : m.includes('3gpp') || m.includes('3gp') ? '3gp'
        : 'webm';

    // Groq SDK espera un File-like object
    const file = new File([audioBuffer], `audio.${ext}`, { type: mimeType });

    const transcription = await groq.audio.transcriptions.create({
        file,
        model: options.model || MODELS.whisper,
        language: 'es'
    });
    return transcription.text || '';
};

export const transcribeTurbo = async (audioBuffer, mimeType = 'audio/webm') => (
    transcribe(audioBuffer, mimeType, { model: MODELS.whisperTurbo })
);

export const PROVIDER_NAME = 'groq';
