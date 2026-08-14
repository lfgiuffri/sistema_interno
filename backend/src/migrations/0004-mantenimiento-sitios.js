/**
 * Migración: módulo `mantenimiento` — sección Sitios web.
 *
 * Idempotente (el DDL en MariaDB hace COMMIT implícito): cada tabla se crea solo si falta.
 * `servicioId` y `servidorId` van con ON DELETE SET NULL: si se borra el servicio o el
 * servidor, el sitio sigue monitoreándose (la relación es informativa, no estructural).
 */

/**
 * Aplica la migración.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @returns {Promise<void>}
 */
export const up = async (sequelize) => {
    const q = sequelize.getQueryInterface();
    // showAllTables() devuelve OBJETOS ({ tableName, schema }) en MariaDB, no strings:
    // convertir con String() daría "[object Object]" y el guard nunca cortaría.
    const existentes = (await q.showAllTables()).map(t => String(t?.tableName ?? t).toLowerCase());
    const hay = (t) => existentes.includes(t);

    if (!hay('sitios_web')) {
        await sequelize.query(`CREATE TABLE sitios_web (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(150) NOT NULL,
            url VARCHAR(255) NOT NULL,
            servicioId INT NULL,
            servidorId INT NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            verificaMarcador TINYINT(1) NOT NULL DEFAULT 1,
            estado ENUM('online','sin_marcador','offline','desconocido') NOT NULL DEFAULT 'desconocido',
            ultimoChequeoAt DATETIME NULL,
            ultimoCodigo INT NULL,
            tiempoMs INT NULL,
            fallosSeguidos INT NOT NULL DEFAULT 0,
            dominio VARCHAR(190) NULL,
            dominioVenceAt DATE NULL,
            dominioAuto TINYINT(1) NOT NULL DEFAULT 0,
            dominioConsultadoAt DATETIME NULL,
            tlsVenceAt DATE NULL,
            observacion TEXT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            deletedAt DATETIME NULL,
            INDEX sitios_web_activo (activo),
            INDEX sitios_web_estado (estado),
            INDEX sitios_web_servidor (servidorId),
            CONSTRAINT sitios_web_ibfk_1 FOREIGN KEY (servidorId) REFERENCES servidores (id) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

        // El FK a servicios se agrega aparte: la tabla puede no existir en un entorno recortado.
        if (hay('servicios')) {
            await sequelize.query(`ALTER TABLE sitios_web
                ADD CONSTRAINT sitios_web_ibfk_2 FOREIGN KEY (servicioId) REFERENCES servicios (id) ON DELETE SET NULL ON UPDATE CASCADE;`);
        }
    }

    if (!hay('sitio_chequeos')) {
        await sequelize.query(`CREATE TABLE sitio_chequeos (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            sitioId INT NOT NULL,
            estado ENUM('online','sin_marcador','offline') NOT NULL,
            httpStatus INT NULL,
            tiempoMs INT NULL,
            motivo VARCHAR(200) NULL,
            createdAt DATETIME NOT NULL,
            INDEX sitio_chequeos_sitio_created (sitioId, createdAt),
            INDEX sitio_chequeos_created (createdAt),
            CONSTRAINT sitio_chequeos_ibfk_1 FOREIGN KEY (sitioId) REFERENCES sitios_web (id) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }

    if (!hay('sitio_incidentes')) {
        await sequelize.query(`CREATE TABLE sitio_incidentes (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            sitioId INT NOT NULL,
            tipo ENUM('offline','sin_marcador','dominio','tls') NOT NULL,
            detalle VARCHAR(255) NULL,
            resueltoAt DATETIME NULL,
            createdAt DATETIME NOT NULL,
            INDEX sitio_incidentes_abierto (sitioId, tipo, resueltoAt),
            INDEX sitio_incidentes_created (createdAt),
            CONSTRAINT sitio_incidentes_ibfk_1 FOREIGN KEY (sitioId) REFERENCES sitios_web (id) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }
};
