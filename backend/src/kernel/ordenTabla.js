/**
 * Orden pedido por el cliente para un listado PAGINADO.
 *
 * Existe porque una tabla paginada no se puede ordenar en el navegador: ordenar la página 1
 * de 76 filas ordena 50 y miente sobre las otras 26. El orden tiene que venir del servidor.
 *
 * La columna NUNCA se interpola en SQL: se busca en un mapa cerrado que declara cada módulo.
 * Una columna desconocida no es un error, cae al orden por defecto — así el frontend puede
 * ofrecer columnas que todavía no soporta el backend sin romper el listado.
 */

/**
 * Traduce `{ orden, dir }` de la query al `order` de Sequelize.
 * @param {object} query - Query de la request (usa `orden` y `dir`).
 * @param {Record<string, Array>} permitidas - Columna → fragmento de `order` en ASC.
 * @param {Array} porDefecto - Orden a usar si no piden nada válido.
 * @returns {Array} Cláusula `order` para Sequelize.
 */
export const ordenSeguro = (query, permitidas, porDefecto) => {
    const col = permitidas[String(query?.orden ?? '')];
    if (!col) return porDefecto;
    const dir = String(query?.dir ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    // Cada fragmento es `[...camino, 'ASC']`: se le pisa la dirección al último elemento.
    const conDir = col.map(frag => [...frag.slice(0, -1), dir]);
    // Desempate estable por id: sin esto, dos filas con el mismo valor pueden saltar de
    // página en página entre pedidos y el usuario ve una fila repetida y otra ausente.
    return [...conDir, ['id', dir]];
};
