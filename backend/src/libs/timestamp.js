/**
 * Genera un timestamp formateado para respuestas de la API
 * @returns {string} Timestamp ISO 8601
 */
export const getFormattedTimestamp = () => {
  return new Date().toISOString();
};