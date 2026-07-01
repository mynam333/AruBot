/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        pastel: {
          mint: 'hsl(var(--accent-mint))',
          coral: 'hsl(var(--accent-coral))',
          lemon: 'hsl(var(--accent-lemon))',
          sky: 'hsl(var(--accent-sky))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px hsl(var(--ring) / 0.14), 0 18px 48px hsl(var(--primary) / 0.14)',
        soft: '0 16px 42px hsl(var(--foreground) / 0.07)',
        subtle: '0 8px 24px hsl(var(--foreground) / 0.06)',
        lift: '0 14px 34px hsl(var(--foreground) / 0.12)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'pulse-line': {
          '0%, 100%': { transform: 'translateX(-30%)', opacity: '0.45' },
          '50%': { transform: 'translateX(30%)', opacity: '1' },
        },
        'tooltip-in': {
          '0%': { opacity: '0', transform: 'translateY(0.25rem) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 420ms ease-out both',
        float: 'float 3.8s ease-in-out infinite',
        'pulse-line': 'pulse-line 5s ease-in-out infinite',
        'tooltip-in': 'tooltip-in 160ms ease-out both',
      },
    },
  },
  plugins: [],
};
