/**
 * Sistema Interno — Tailwind config (design system propio).
 *
 * Los colores mapean a CSS custom properties definidas en src/theme/global.css, así el
 * tema claro/oscuro se resuelve por variables (una sola fuente de verdad) y las clases
 * de Tailwind funcionan en ambos temas sin duplicar utilidades.
 *
 * Dirección de diseño (PRD §7.0): neutros fríos (zinc) + UN acento (esmeralda desaturado),
 * bordes 1px, sombras casi nulas, densidad media. Nada de índigo/púrpura genérico.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '.dark'],
  theme: {
    extend: {
      colors: {
        // Superficies y tinta: variables de tema (claro/oscuro en global.css).
        surface: {
          DEFAULT: 'rgb(var(--s-surface) / <alpha-value>)',   // cards, popovers
          2: 'rgb(var(--s-surface-2) / <alpha-value>)',        // fondos sutiles (hover, filas alternas)
          3: 'rgb(var(--s-surface-3) / <alpha-value>)',        // inputs, wells
        },
        canvas: 'rgb(var(--s-canvas) / <alpha-value>)',        // fondo de página
        ink: {
          DEFAULT: 'rgb(var(--s-ink) / <alpha-value>)',        // texto principal
          soft: 'rgb(var(--s-ink-soft) / <alpha-value>)',      // texto secundario
          faint: 'rgb(var(--s-ink-faint) / <alpha-value>)',    // placeholders, hints
        },
        line: {
          DEFAULT: 'rgb(var(--s-line) / <alpha-value>)',       // bordes 1px
          soft: 'rgb(var(--s-line-soft) / <alpha-value>)',     // separadores suaves
        },
        // Acento único (esmeralda desaturado) + estados semánticos.
        accent: {
          DEFAULT: 'rgb(var(--s-accent) / <alpha-value>)',
          hover: 'rgb(var(--s-accent-hover) / <alpha-value>)',
          soft: 'rgb(var(--s-accent-soft) / <alpha-value>)',   // tinte de fondo
          ink: 'rgb(var(--s-accent-ink) / <alpha-value>)',     // texto sobre tinte
        },
        danger: {
          DEFAULT: 'rgb(var(--s-danger) / <alpha-value>)',
          soft: 'rgb(var(--s-danger-soft) / <alpha-value>)',
        },
        warn: {
          DEFAULT: 'rgb(var(--s-warn) / <alpha-value>)',
          soft: 'rgb(var(--s-warn-soft) / <alpha-value>)',
        },
        ok: {
          DEFAULT: 'rgb(var(--s-ok) / <alpha-value>)',
          soft: 'rgb(var(--s-ok-soft) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // Escala contenida: la jerarquía se controla con peso y color, no con tamaño.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        // Sombras teñidas al fondo, casi nulas (dirección Linear/Notion).
        card: '0 1px 2px 0 rgb(var(--s-shadow) / 0.05)',
        pop: '0 4px 24px -4px rgb(var(--s-shadow) / 0.12), 0 1px 2px 0 rgb(var(--s-shadow) / 0.06)',
      },
      height: {
        row: '44px', // densidad media: fila estándar de tabla/lista (apta touch)
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
