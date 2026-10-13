import animate from 'tailwindcss-animate';

/** Colour tokens live as RGB channel triplets in src/index.css so Tailwind's
 *  opacity modifiers work (e.g. bg-olive/15). */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Vireo design tokens
        'surface-000': token('surface-000'),
        'surface-100': token('surface-100'),
        'surface-200': token('surface-200'),
        line: token('line'),
        ink: { DEFAULT: token('ink'), muted: token('ink-muted') },
        olive: { DEFAULT: token('olive'), soft: token('olive-soft'), foreground: token('on-olive') },
        amber: { DEFAULT: token('amber'), soft: token('amber-soft') },
        sky: token('sky'),
        alert: token('alert'),

        // shadcn/ui theme slots, pointed at the tokens above
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        background: token('background'),
        foreground: token('foreground'),
        primary: { DEFAULT: token('primary'), foreground: token('primary-foreground') },
        secondary: { DEFAULT: token('secondary'), foreground: token('secondary-foreground') },
        destructive: { DEFAULT: token('destructive'), foreground: token('destructive-foreground') },
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        popover: { DEFAULT: token('popover'), foreground: token('popover-foreground') },
        card: { DEFAULT: token('card'), foreground: token('card-foreground') },
        paper: { DEFAULT: token('paper'), foreground: token('paper-foreground') },

        // Legacy palette, still used by src/legacy and src/components until Phase 5
        dark: {
          900: '#0B0F19',
          800: '#111827',
          700: '#1F2937',
          600: '#374151',
        },
        hud: {
          cyan: '#06B6D4',
          amber: '#F59E0B',
          rose: '#F43F5E',
          emerald: '#10B981'
        }
      },
      fontFamily: {
        display: ['Newsreader', 'Georgia', 'serif'],
        sans: ['"Schibsted Grotesk"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['112px', { lineHeight: '106px', letterSpacing: '-0.035em' }],
        'display-l': ['56px', { lineHeight: '58px', letterSpacing: '-0.02em' }],
        'note-title': ['30px', { lineHeight: '34px', letterSpacing: '-0.01em' }],
        annotation: ['20px', { lineHeight: '28px' }],
        metric: ['88px', { lineHeight: '88px', letterSpacing: '-0.03em' }],
        heading: ['22px', { lineHeight: '28px', fontWeight: '600' }],
        body: ['17px', { lineHeight: '27px' }],
        small: ['14px', { lineHeight: '21px' }],
        label: ['15px', { lineHeight: '20px', fontWeight: '600' }],
      },
      borderRadius: {
        sm: '6px',
        md: '18px',
        lg: '28px',
        pill: '999px',
      },
      maxWidth: {
        container: '1240px',
      },
      boxShadow: {
        lift: 'var(--shadow-lift)',
      },
    },
  },
  plugins: [animate],
}
