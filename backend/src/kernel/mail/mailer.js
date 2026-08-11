/**
 * Zero 2.0 — Mailer pluggable.
 *
 * Si hay SMTP configurado (SMTP_HOST/PORT/USER/PASS), envía con nodemailer; si no, loguea
 * el mail por consola (modo dev, como el "local_smtp" de Supabase). Así passwordless/OTP/
 * invitaciones funcionan en dev sin SMTP y en prod con SMTP real, sin cambiar código.
 */

/** @returns {boolean} true si hay SMTP configurado. */
export const isSmtpConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_PORT);

let _transport = null;
/** Crea (lazy) el transport de nodemailer. @returns {Promise<object|null>} */
const getTransport = async () => {
    if (_transport) return _transport;
    if (!isSmtpConfigured()) return null;
    const nodemailer = (await import('nodemailer')).default;
    _transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10),
        secure: String(process.env.SMTP_SECURE || 'false') === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
    return _transport;
};

/**
 * Envía un email (o lo loguea en dev si no hay SMTP).
 * @param {object} mail - { to, subject, text?, html? }.
 * @returns {Promise<{sent: boolean, dev?: boolean}>} Resultado del envío.
 */
export const sendMail = async ({ to, subject, text, html }) => {
    const from = process.env.MAIL_FROM || `${process.env.APP_NAME || 'Zero'} <no-reply@localhost>`;
    const transport = await getTransport();
    if (!transport) {
        // Modo dev: no enviamos de verdad, mostramos el contenido para poder testear flujos.
        console.log(`📧 [MAIL:dev] to=${to} | subject="${subject}"\n${text || html || ''}`);
        return { sent: false, dev: true };
    }
    await transport.sendMail({ from, to, subject, text, html });
    return { sent: true };
};
