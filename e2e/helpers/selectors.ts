/**
 * Selectores para la UI del shell de Zero 2.0.
 *
 * Preferimos selectores accesibles (roles + accessible name) sobre clases CSS,
 * por lo que muchas entradas son *patrones de búsqueda* que las specs combinan con
 * locators basados en roles: `page.getByRole(...)`, `page.getByLabel(...)`, etc.
 *
 * El shell de Zero 2.0 es plan-aware (menú dinámico armado desde GET /me), así que
 * evitamos acoplar los tests a clases concretas: nos apoyamos en texto/rol.
 */
export const SEL = {
  // Login
  login: {
    // Nombres accesibles posibles para los campos (case-insensitive, ES/EN).
    usernameLabel: /usuario|email|correo|username/i,
    passwordLabel: /contraseña|password/i,
    submitName: /ingresar|iniciar sesión|entrar|login|acceder/i,
    error: /credenciales|inválid|error/i,
  },

  // Shell / navegación
  shell: {
    // Landmark de navegación principal (sidebar/menú).
    nav: 'nav, aside, ion-menu, [role="navigation"]',
    navLink: (text: string | RegExp) => text,
    logoutName: /salir|cerrar sesión|logout/i,
  },

  // Dashboard / home
  dashboard: {
    heading: /dashboard|inicio|home|panel/i,
  },

  // Items (módulo de ejemplo)
  areas: {
    heading: /áreas|areas/i,
    addName: /nuevo|agregar|crear|añadir/i,
    nameInputLabel: /nombre|name/i,
    row: 'tr, ion-item, [data-testid="item-row"], .item-card',
  },

  // Settings
  settings: {
    heading: /ajustes|configuración|settings/i,
  },
};
