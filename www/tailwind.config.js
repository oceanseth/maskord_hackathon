/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        maskord: {
          dark:    '#0a0a0f',
          darker:  '#06060a',
          surface: '#12121a',
          border:  '#1e1e2e',
          accent:  '#7c3aed', // violet-600
          glow:    '#a855f7', // purple-500
          muted:   '#6b7280',
          text:    '#e2e8f0',
          subtle:  '#94a3b8',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body:    ['"Inter"', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'fade-in':      'fadeIn 0.6s ease-out forwards',
        'slide-up':     'slideUp 0.7s ease-out forwards',
        'glow-pulse':   'glowPulse 3s ease-in-out infinite',
        'mask-float':   'maskFloat 6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:   { from: { opacity: '0', transform: 'translateY(24px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(124,58,237,0.3)' },
          '50%':      { boxShadow: '0 0 60px rgba(168,85,247,0.6)' },
        },
        maskFloat: {
          '0%, 100%': { transform: 'translateY(0) rotate(-2deg)' },
          '50%':      { transform: 'translateY(-12px) rotate(2deg)' },
        },
      },
    },
  },
  plugins: [],
};
