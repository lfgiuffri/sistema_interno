import 'dotenv/config';

const BASE_URL = 'https://openrouter.ai/api/v1';
const MODEL = 'openrouter/free';

const getApiKey = () => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY no configurada');
    return key;
};

const makeRequest = async (endpoint, body) => {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getApiKey()}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://sys.positivemedia.com.ar',
            'X-Title': 'Sistema Interno'
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenRouter API error ${response.status}: ${err}`);
    }
    return response.json();
};

/**
 * Chat completion con texto
 * @param {Array} messages - Mensajes en formato OpenAI [{role, content}]
 * @param {Object} options - { temperature, maxTokens }
 * @returns {string} Contenido de la respuesta
 */
export const chat = async (messages, options = {}) => {
    const result = await makeRequest('/chat/completions', {
        model: MODEL,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens || 2048
    });
    return result.choices[0].message.content;
};

/**
 * Chat completion con respuesta JSON (via instrucciones en prompt)
 * OpenRouter/free no garantiza JSON mode nativo, se fuerza via prompt
 * @param {Array} messages - Mensajes en formato OpenAI [{role, content}]
 * @param {Object} options - { temperature, maxTokens }
 * @returns {Object} JSON parseado
 */
export const chatJSON = async (messages, options = {}) => {
    // Agregar instrucción de JSON al system prompt si existe
    const enhancedMessages = messages.map(m => {
        if (m.role === 'system') {
            return {
                ...m,
                content: m.content + '\n\nIMPORTANTE: Responde ÚNICAMENTE con JSON válido, sin markdown ni texto adicional.'
            };
        }
        return m;
    });

    const result = await makeRequest('/chat/completions', {
        model: MODEL,
        messages: enhancedMessages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens || 2048
    });

    const content = result.choices[0].message.content;
    // Intentar parsear directamente, si falla buscar JSON en el texto
    try {
        return JSON.parse(content);
    } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('OpenRouter no devolvió JSON válido');
        return JSON.parse(jsonMatch[0]);
    }
};

/**
 * Análisis de imagen (visión) via OpenRouter
 * @param {string} imageBase64 - Imagen en base64
 * @param {string} prompt - Instrucción para el análisis
 * @param {Object} options - { temperature, maxTokens }
 * @returns {string} Resultado del análisis
 */
export const vision = async (imageBase64, prompt, options = {}) => {
    const result = await makeRequest('/chat/completions', {
        model: MODEL,
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
            ]
        }],
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens || 1000
    });
    return result.choices[0].message.content;
};

export const PROVIDER_NAME = 'openrouter';
