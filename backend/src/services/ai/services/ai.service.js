/**
 * Sistema Interno — Servicio de IA multi-proveedor (genérico, sin dominio).
 *
 * Orquesta tres proveedores con fallback automático:
 *   1. Groq (Llama 3.3 70B)  → primario: texto/JSON, rapidísimo y barato.
 *   2. Gemini (2.5 Flash)    → contexto largo, visión y embeddings.
 *   3. OpenRouter            → backup universal.
 *
 * Expone primitivas genéricas (chat, chatJSON, interpretText, vision, transcribe,
 * embed, summarize, analyzeDeep). NO contiene prompts ni lógica de ningún dominio:
 * cada módulo que use IA arma su propio systemPrompt y lo pasa a interpretText().
 */

import * as groq from '../providers/groq.provider.js';
import * as gemini from '../providers/gemini.provider.js';
import * as openrouter from '../providers/openrouter.provider.js';

/**
 * Ejecuta una lista de proveedores en orden hasta que uno responda sin error.
 * @param {Array<{name: string, fn: () => Promise<any>}>} providers - Proveedores a intentar, en orden de preferencia.
 * @returns {Promise<any>} El resultado del primer proveedor exitoso.
 * @throws {Error} El error del último proveedor si todos fallan.
 */
const withFallback = async (providers) => {
    let lastError;
    // Recorremos en orden: el primero que no tire error gana.
    for (const { name, fn } of providers) {
        try {
            return await fn();
        } catch (error) {
            // Logueamos y seguimos al siguiente proveedor (degradación elegante).
            console.warn(`⚠️ [AI] ${name} falló: ${error.message}`);
            lastError = error;
        }
    }
    // Ninguno respondió: propagamos el último error para que el caller decida.
    throw lastError;
};

/**
 * Traduce un error de transcripción a un mensaje amigable en español.
 * @param {Error|string} error - Error crudo del proveedor de voz.
 * @returns {string} Mensaje listo para mostrar al usuario.
 */
export const getFriendlyTranscriptionError = (error) => {
    const message = `${error?.message || error || ''}`.toLowerCase();
    // Rate limit / cuota agotada → sugerir reintentar más tarde.
    if (message.includes('rate limit') || message.includes('429') || message.includes('quota') || message.includes('limitad')) {
        return 'El servicio de voz está limitado en este momento. Probá de nuevo en unos minutos o mandalo escrito.';
    }
    // Formato de audio no soportado.
    if (message.includes('mime') || message.includes('audio') || message.includes('unsupported') || message.includes('invalid')) {
        return 'No pude leer el formato del audio. Probá grabarlo de nuevo o mandalo escrito.';
    }
    return 'No pude transcribir el audio en este momento. Probá de nuevo en unos minutos o mandalo escrito.';
};

/**
 * Chat de texto libre (devuelve string). Groq → Gemini → OpenRouter.
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages - Mensajes estilo chat.
 * @param {object} [options] - Opciones del proveedor (temperature, maxTokens, ...).
 * @returns {Promise<string>} La respuesta del modelo como texto plano.
 */
export const chat = async (messages, options = {}) => {
    return withFallback([
        { name: 'Groq', fn: () => groq.chat(messages, options) },
        { name: 'Gemini', fn: () => gemini.chat(messages, options) },
        { name: 'OpenRouter', fn: () => openrouter.chat(messages, options) }
    ]);
};

/**
 * Chat que fuerza salida JSON (devuelve objeto parseado). Groq → Gemini → OpenRouter.
 * @param {Array<{role: string, content: string}>} messages - Mensajes estilo chat.
 * @param {object} [options] - Opciones del proveedor.
 * @returns {Promise<object>} JSON parseado de la respuesta del modelo.
 */
export const chatJSON = async (messages, options = {}) => {
    return withFallback([
        { name: 'Groq', fn: () => groq.chatJSON(messages, options) },
        { name: 'Gemini', fn: () => gemini.chatJSON(messages, options) },
        { name: 'OpenRouter', fn: () => openrouter.chatJSON(messages, options) }
    ]);
};

/**
 * Interpreta un texto del usuario contra un systemPrompt provisto por el caller
 * y devuelve la intención como JSON. Es la primitiva genérica de "intent": cada
 * módulo arma su propio prompt/esquema de intenciones y lo pasa acá.
 * @param {string} message - Texto del usuario a interpretar.
 * @param {object} opts - Configuración de la interpretación.
 * @param {string} opts.systemPrompt - Prompt de sistema que define el esquema de intención esperado.
 * @param {number} [opts.temperature=0.3] - Creatividad del modelo (bajo = determinístico).
 * @returns {Promise<object>} La intención interpretada como objeto JSON.
 */
export const interpretText = async (message, { systemPrompt, temperature = 0.3 } = {}) => {
    if (!systemPrompt) throw new Error('interpretText requiere opts.systemPrompt');
    // Construimos el formato chat estándar: instrucción de sistema + turno del usuario.
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
    ];
    return chatJSON(messages, { temperature });
};

/**
 * Analiza una imagen con un prompt libre (visión). Gemini → OpenRouter.
 * @param {string} imageBase64 - Imagen codificada en base64 (sin prefijo data:).
 * @param {string} prompt - Instrucción sobre qué hacer con la imagen.
 * @param {object} [options] - Opciones del proveedor (temperature, maxTokens).
 * @returns {Promise<string|object>} Texto u objeto según lo que devuelva el proveedor.
 */
export const vision = async (imageBase64, prompt, options = {}) => {
    return withFallback([
        { name: 'Gemini', fn: () => gemini.vision(imageBase64, prompt, options) },
        { name: 'OpenRouter', fn: () => openrouter.vision(imageBase64, prompt, options) }
    ]);
};

/**
 * Transcribe audio a texto. Groq Whisper Turbo → Groq Whisper → Gemini audio.
 * @param {Buffer} audioBuffer - Contenido binario del audio.
 * @param {string} [mimeType='audio/webm'] - MIME del audio (webm/ogg/mp3/...).
 * @returns {Promise<string>} El texto transcripto.
 * @throws {Error} Mensaje amigable si todos los proveedores fallan.
 */
export const transcribeAudio = async (audioBuffer, mimeType = 'audio/webm') => {
    try {
        return await withFallback([
            { name: 'Groq Whisper Turbo', fn: () => groq.transcribeTurbo(audioBuffer, mimeType) },
            { name: 'Groq Whisper', fn: () => groq.transcribe(audioBuffer, mimeType) },
            { name: 'Gemini audio', fn: () => gemini.transcribe(audioBuffer, mimeType) }
        ]);
    } catch (error) {
        // Convertimos el error técnico en algo mostrable al usuario.
        throw new Error(getFriendlyTranscriptionError(error));
    }
};

/**
 * Análisis profundo en JSON (Gemini primero por su contexto largo).
 * @param {Array<{role: string, content: string}>} messages - Mensajes estilo chat.
 * @param {object} [options] - { temperature, maxTokens }.
 * @returns {Promise<object>} JSON parseado del análisis.
 */
export const analyzeDeep = async (messages, options = {}) => {
    const opts = { temperature: 0.4, maxTokens: 3000, ...options };
    return withFallback([
        { name: 'Gemini', fn: () => gemini.chatJSON(messages, opts) },
        { name: 'Groq', fn: () => groq.chatJSON(messages, opts) },
        { name: 'OpenRouter', fn: () => openrouter.chatJSON(messages, opts) }
    ]);
};

/**
 * Resume texto largo conservando puntos clave (map-reduce previo a un análisis).
 * @param {string} text - Texto a resumir.
 * @param {string} [instruction] - Instrucción de resumen (idioma, foco, longitud).
 * @returns {Promise<string>} El resumen generado.
 */
export const summarizeText = async (text, instruction = 'Resumí el siguiente contenido conservando los datos y detalles técnicos clave para un análisis posterior.') => {
    const messages = [
        { role: 'system', content: instruction },
        { role: 'user', content: text }
    ];
    const opts = { temperature: 0.3, maxTokens: 1800 };
    return withFallback([
        { name: 'Gemini', fn: () => gemini.chat(messages, opts) },
        { name: 'Groq', fn: () => groq.chat(messages, opts) },
        { name: 'OpenRouter', fn: () => openrouter.chat(messages, opts) }
    ]);
};

/**
 * Calcula el embedding (vector) de un texto. Solo Gemini (text-embedding-004).
 * Degrada con gracia: si falla, devuelve null en vez de tirar (la búsqueda semántica
 * es opcional y no debe romper el flujo principal).
 * @param {string} text - Texto a vectorizar.
 * @returns {Promise<number[]|null>} El vector de embedding, o null si no se pudo.
 */
export const embedText = async (text) => {
    if (!text || !text.trim()) return null;
    try {
        return await gemini.embed(text);
    } catch (error) {
        console.warn('⚠️ [AI] embed falló:', error.message);
        return null;
    }
};
