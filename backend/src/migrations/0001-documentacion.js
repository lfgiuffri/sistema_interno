/**
 * Migración: módulo `documentacion` — espacios propios, accesos, listas, documentos,
 * versiones y archivos.
 *
 * Idempotente (el DDL en MariaDB hace COMMIT implícito, así que la transacción no revierte):
 * cada tabla se crea solo si no existe.
 */

/**
 * Aplica la migración.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @param {object} Sequelize - Namespace de Sequelize (tipos, Op, ...).
 * @returns {Promise<void>}
 */
export const up = async (sequelize) => {
    const q = sequelize.getQueryInterface();
    const existentes = await q.showAllTables();
    const hay = (t) => existentes.map(String).map(s => s.toLowerCase()).includes(t);

    if (!hay('doc_espacios')) {
        await sequelize.query(`CREATE TABLE doc_espacios (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(100) NOT NULL,
            descripcion VARCHAR(255) NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            deletedAt DATETIME NULL,
            INDEX doc_espacios_activo (activo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }

    if (!hay('usuario_doc_espacios')) {
        await sequelize.query(`CREATE TABLE usuario_doc_espacios (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            userId INT NOT NULL,
            docEspacioId INT NOT NULL,
            ver TINYINT(1) NOT NULL DEFAULT 1,
            editar TINYINT(1) NOT NULL DEFAULT 0,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            UNIQUE KEY usuario_doc_espacios_user_id_doc_espacio_id (userId, docEspacioId),
            INDEX usuario_doc_espacios_doc_espacio_id (docEspacioId),
            CONSTRAINT usuario_doc_espacios_ibfk_1 FOREIGN KEY (userId) REFERENCES users (id) ON UPDATE CASCADE,
            CONSTRAINT usuario_doc_espacios_ibfk_2 FOREIGN KEY (docEspacioId) REFERENCES doc_espacios (id) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }

    if (!hay('doc_listas')) {
        await sequelize.query(`CREATE TABLE doc_listas (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            docEspacioId INT NOT NULL,
            nombre VARCHAR(120) NOT NULL,
            descripcion VARCHAR(255) NULL,
            orden INT NOT NULL DEFAULT 0,
            activa TINYINT(1) NOT NULL DEFAULT 1,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            deletedAt DATETIME NULL,
            INDEX doc_listas_doc_espacio_id (docEspacioId),
            INDEX doc_listas_doc_espacio_id_orden (docEspacioId, orden),
            CONSTRAINT doc_listas_ibfk_1 FOREIGN KEY (docEspacioId) REFERENCES doc_espacios (id) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }

    if (!hay('documentos')) {
        await sequelize.query(`CREATE TABLE documentos (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            docEspacioId INT NOT NULL,
            docListaId INT NOT NULL,
            titulo VARCHAR(200) NOT NULL,
            contenido MEDIUMTEXT NULL,
            orden INT NOT NULL DEFAULT 0,
            creadoPor INT NULL,
            actualizadoPor INT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            deletedAt DATETIME NULL,
            INDEX documentos_doc_espacio_id (docEspacioId),
            INDEX documentos_doc_lista_id_orden (docListaId, orden),
            INDEX documentos_titulo (titulo),
            CONSTRAINT documentos_ibfk_1 FOREIGN KEY (docEspacioId) REFERENCES doc_espacios (id) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT documentos_ibfk_2 FOREIGN KEY (docListaId) REFERENCES doc_listas (id) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT documentos_ibfk_3 FOREIGN KEY (creadoPor) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
            CONSTRAINT documentos_ibfk_4 FOREIGN KEY (actualizadoPor) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }

    if (!hay('documento_versiones')) {
        await sequelize.query(`CREATE TABLE documento_versiones (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            documentoId INT NOT NULL,
            titulo VARCHAR(200) NOT NULL,
            contenido MEDIUMTEXT NULL,
            userId INT NULL,
            createdAt DATETIME NOT NULL,
            INDEX documento_versiones_documento_id_created_at (documentoId, createdAt),
            CONSTRAINT documento_versiones_ibfk_1 FOREIGN KEY (documentoId) REFERENCES documentos (id) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT documento_versiones_ibfk_2 FOREIGN KEY (userId) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }

    if (!hay('documento_archivos')) {
        await sequelize.query(`CREATE TABLE documento_archivos (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(60) NOT NULL UNIQUE,
            nombreOriginal VARCHAR(200) NOT NULL,
            tipo ENUM('imagen','archivo') NOT NULL,
            mime VARCHAR(100) NOT NULL,
            size INT NOT NULL,
            documentoId INT NULL,
            userId INT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            INDEX documento_archivos_documento_id (documentoId),
            INDEX documento_archivos_created_at (createdAt),
            CONSTRAINT documento_archivos_ibfk_1 FOREIGN KEY (documentoId) REFERENCES documentos (id) ON DELETE SET NULL ON UPDATE CASCADE,
            CONSTRAINT documento_archivos_ibfk_2 FOREIGN KEY (userId) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }
};
