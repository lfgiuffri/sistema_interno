import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

let genAI = null;

const getClient = () => {
    if (!genAI) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');
        genAI = new GoogleGenerativeAI(apiKey);
    }
    return genAI;
};

const MODEL = 'gemini-2.5-flash';

/**
 * Chat completion con texto
 * @param {Array} messages - Mensajes en formato OpenAI [{role, content}]
 * @param {Object} options - { temperature, maxTokens }
 * @returns {string} Contenido de la respuesta
 */
export const chat = async (messages, options = {}) => {
    const ai = getClient();
    const model = ai.getGenerativeModel({
        model: MODEL,
        generationConfig: {
            temperature: options.temperature ?? 0.3,
            maxOutputTokens: options.maxTokens || 2048
        }
    });

    // Convertir formato OpenAI → Gemini
    const { systemInstruction, contents } = convertMessages(messages);

    const result = await model.generateContent({
        systemInstruction,
        contents
    });
    return result.response.text();
};

/**
 * Chat completion con respuesta JSON
 * @param {Array} messages - Mensajes en formato OpenAI [{role, content}]
 * @param {Object} options - { temperature, maxTokens }
 * @returns {Object} JSON parseado
 */
export const chatJSON = async (messages, options = {}) => {
    const ai = getClient();
    const model = ai.getGenerativeModel({
        model: MODEL,
        generationConfig: {
            temperature: options.temperature ?? 0.3,
            maxOutputTokens: options.maxTokens || 2048,
            responseMimeType: 'application/json'
        }
    });

    const { systemInstruction, contents } = convertMessages(messages);

    const result = await model.generateContent({
        systemInstruction,
        contents
    });
    const text = result.response.text();
    return JSON.parse(text);
};

/**
 * Análisis de imagen (visión)
 * @param {string} imageBase64 - Imagen en base64
 * @param {string} prompt - Instrucción para el análisis
 * @param {Object} options - { temperature, maxTokens }
 * @returns {string} Resultado del análisis
 */
export const vision = async (imageBase64, prompt, options = {}) => {
    const ai = getClient();
    const model = ai.getGenerativeModel({
        model: MODEL,
        generationConfig: {
            temperature: options.temperature ?? 0.3,
            maxOutputTokens: options.maxTokens || 1000
        }
    });

    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: imageBase64,
                mimeType: 'image/jpeg'
            }
        }
    ]);
    return result.response.text();
};

/**
 * Transcripción de audio usando Gemini como fallback de Whisper.
 * @param {Buffer} audioBuffer - Buffer del archivo de audio
 * @param {string} mimeType - Tipo MIME del audio
 * @returns {string} Texto transcrito
 */
export const transcribe = async (audioBuffer, mimeType = 'audio/webm') => {
    const ai = getClient();
    const model = ai.getGenerativeModel({
        model: MODEL,
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 1000
        }
    });

    const prompt = 'Transcribí este audio en español argentino. Devolvé únicamente el texto transcripto, sin comillas, sin markdown y sin comentarios. Si no se entiende, devolvé una cadena vacía.';
    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: audioBuffer.toString('base64'),
                mimeType: mimeType || 'audio/webm'
            }
        }
    ]);

    return (result.response.text() || '').trim();
};

/**
 * Embedding de texto (memoria semántica). Gemini text-embedding-004 → ~768 dims.
 * @param {string} text
 * @returns {number[]} vector
 */
export const embed = async (text) => {
    const ai = getClient();
    const model = ai.getGenerativeModel({ model: 'gemini-embedding-001' });
    const result = await model.embedContent({
        content: { role: 'user', parts: [{ text: (text || '').slice(0, 8000) }] },
        outputDimensionality: 768
    });
    return result.embedding.values;
};

/**
 * Convierte mensajes formato OpenAI → formato Gemini
 */
function convertMessages(messages) {
    let systemInstruction = undefined;
    const contents = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemInstruction = msg.content;
        } else {
            contents.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            });
        }
    }

    return { systemInstruction, contents };
}

export const PROVIDER_NAME = 'gemini';
