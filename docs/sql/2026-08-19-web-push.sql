-- ============================================================================
--  Sistema Interno — Notificaciones del navegador (Web Push) · 19/08/2026
-- ============================================================================
--
--  Solo si actualizás la base a mano. Si desplegás el código y reiniciás el backend con
--  AUTO_MIGRATE distinto de "false", la migración 0005 hace esto solo.
--
--    mysqldump -u sistema -p sistema_interno > backup-antes-webpush.sql
--    mysql -u sistema -p sistema_interno < 2026-08-19-web-push.sql
--
--  ES RE-EJECUTABLE.
--
--  ⚠️ NO ALCANZA CON EL SQL. Hace falta además, en el `.env` del servidor:
--
--       VAPID_PUBLIC_KEY=...
--       VAPID_PRIVATE_KEY=...
--       VAPID_SUBJECT=mailto:soporte@positivemedia.com.ar
--
--     Se generan UNA vez con:  npx web-push generate-vapid-keys
--     y NO se cambian nunca: la clave pública queda grabada dentro de la suscripción de cada
--     navegador, así que rotarla invalida todas y hay que volver a activarlas una por una.
--     Sin estas variables el servidor arranca igual, pero avisa por log y las notificaciones
--     del navegador quedan deshabilitadas.
-- ============================================================================

-- Una fila por NAVEGADOR, no por usuario: la misma persona puede tener la app abierta en la
-- compu de la oficina, en la de casa y en el celular, y cada una es una suscripción distinta.
--
-- Sin `deletedAt` a propósito: cuando el servicio de push contesta 410 Gone (el usuario borró
-- los datos del navegador o revocó el permiso) la fila se BORRA. No es un dato de negocio,
-- es una dirección de entrega que dejó de existir; conservarla solo haría que cada envío
-- futuro la reintente para siempre.
CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `endpoint` VARCHAR(500) NOT NULL,
  `p256dh` VARCHAR(255) NOT NULL,   -- clave pública del navegador (cifra el contenido)
  `auth` VARCHAR(255) NOT NULL,     -- secreto de autenticación del navegador
  `userAgent` VARCHAR(255) DEFAULT NULL,
  `ultimoEnvioAt` DATETIME DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  -- Único: el mismo navegador re-suscribiéndose actualiza sus claves en vez de duplicarse.
  UNIQUE KEY `push_subscriptions_endpoint` (`endpoint`),
  KEY `push_subscriptions_user` (`userId`),
  CONSTRAINT `push_subscriptions_ibfk_1` FOREIGN KEY (`userId`)
    REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `name` VARCHAR(255) NOT NULL,
  `appliedAt` DATETIME NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `schema_migrations` (`name`, `appliedAt`) VALUES ('0005-web-push.js', NOW());

-- Verificación:
--   SELECT COUNT(*) FROM push_subscriptions;   -- 0 al principio; suma uno por navegador activado
