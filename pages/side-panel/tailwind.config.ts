import baseConfig from '@extension/tailwindcss-config';
import type { Config } from 'tailwindcss/types/config';

export default {
  ...baseConfig,
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* ===== 中式修行配色系统 ===== */
        // 主色系 - 墨色
        ink: {
          900: '#0A0908',
          800: '#1C1917',
          700: '#292524',
          600: '#44403C',
          500: '#57534E',
          400: '#78716C',
          300: '#A8A29E',
          200: '#D6D3D1',
          100: '#F5F5F4',
        },
        // 玉色 - 青玉 / 白玉
        jade: {
          deep: '#2D6A4F',
          primary: '#40916C',
          light: '#52B788',
          pale: '#74C69D',
          glow: '#95D5B2',
          palest: '#D8F3DC',
        },
        // 金色 - 灵金 / 晨曦
        gold: {
          deep: '#92400E',
          primary: '#D97706',
          light: '#F59E0B',
          bright: '#FBBF24',
          glow: '#FDE68A',
          pale: '#FEF3C7',
        },
        // 朱砂 - 印章红
        cinnabar: {
          deep: '#991B1B',
          primary: '#DC2626',
          light: '#EF4444',
          pale: '#FCA5A5',
          glow: '#FEE2E2',
        },
        // 云雾 - 背景雾气
        mist: {
          900: 'rgba(255,255,255,0.02)',
          800: 'rgba(255,255,255,0.04)',
          700: 'rgba(255,255,255,0.08)',
          600: 'rgba(255,255,255,0.12)',
          500: 'rgba(255,255,255,0.18)',
          400: 'rgba(255,255,255,0.25)',
        },
      },
      backgroundImage: {
        // 宣纸质感背景
        'rice-paper': `
          linear-gradient(180deg,
            #FAF8F5 0%,
            #F5F2ED 30%,
            #FAF8F5 60%,
            #F2EDE4 100%
          )
        `,
        'rice-paper-dark': `
          linear-gradient(180deg,
            #12100E 0%,
            #1A1815 30%,
            #151310 60%,
            #0F0E0C 100%
          )
        `,
        // 山水云雾渐变
        'mist-mountain': `
          radial-gradient(ellipse at 20% 80%, rgba(64, 145, 108, 0.08) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 20%, rgba(217, 119, 6, 0.05) 0%, transparent 50%),
          radial-gradient(ellipse at 50% 50%, rgba(45, 106, 79, 0.04) 0%, transparent 70%)
        `,
        'mist-mountain-dark': `
          radial-gradient(ellipse at 20% 80%, rgba(82, 183, 136, 0.06) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 20%, rgba(245, 158, 11, 0.04) 0%, transparent 50%),
          radial-gradient(ellipse at 50% 50%, rgba(149, 213, 178, 0.03) 0%, transparent 70%)
        `,
        // 玉石光泽
        'jade-glow': `linear-gradient(135deg, rgba(64, 145, 108, 0.15), rgba(82, 183, 136, 0.08))`,
        'gold-shimmer': `linear-gradient(135deg, rgba(217, 119, 6, 0.12), rgba(251, 191, 36, 0.06))`,
        // 边框渐变
        'border-jade': `linear-gradient(135deg, #40916C, #52B788, #40916C)`,
        'border-gold': `linear-gradient(135deg, #D97706, #FBBF24, #D97706)`,
        // 按钮渐变
        'btn-jade': `linear-gradient(135deg, #2D6A4F, #40916C)`,
        'btn-gold': `linear-gradient(135deg, #B45309, #D97706)`,
        // 宣纸纹理叠加
        'paper-texture': `
          url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E")
        `,
      },
      boxShadow: {
        // 玉质光晕
        'jade-sm': '0 2px 12px rgba(64, 145, 108, 0.15)',
        'jade-md': '0 4px 20px rgba(64, 145, 108, 0.18)',
        'jade-lg': '0 8px 32px rgba(64, 145, 108, 0.22)',
        'jade-inset': 'inset 0 0 16px rgba(64, 145, 108, 0.08)',
        // 金色光晕
        'gold-sm': '0 2px 12px rgba(217, 119, 6, 0.12)',
        'gold-md': '0 4px 20px rgba(217, 119, 6, 0.16)',
        // 墨韵阴影
        'ink-sm': '0 2px 8px rgba(28, 25, 23, 0.10)',
        'ink-md': '0 4px 16px rgba(28, 25, 23, 0.14)',
        'ink-lg': '0 8px 32px rgba(28, 25, 23, 0.18)',
        // 纸质柔和阴影
        paper: '0 4px 24px rgba(139, 115, 85, 0.08)',
        'paper-dark': '0 4px 24px rgba(0, 0, 0, 0.35)',
        // 发光效果
        'spirit-glow': '0 0 20px rgba(64, 145, 108, 0.25), 0 0 48px rgba(64, 145, 108, 0.1)',
        'spirit-glow-gold': '0 0 20px rgba(217, 119, 6, 0.2), 0 0 48px rgba(217, 119, 6, 0.08)',
      },
      keyframes: {
        progress: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        // 器灵动画
        'spirit-float': {
          '0%, 100%': { transform: 'translateY(0px) rotate(0deg)' },
          '33%': { transform: 'translateY(-6px) rotate(1deg)' },
          '66%': { transform: 'translateY(-3px) rotate(-1deg)' },
        },
        'spirit-breathe': {
          '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
          '50%': { opacity: '0.88', filter: 'brightness(1.05)' },
        },
        'spirit-glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 16px rgba(64, 145, 108, 0.2)' },
          '50%': { boxShadow: '0 0 32px rgba(64, 145, 108, 0.4), 0 0 56px rgba(64, 145, 108, 0.15)' },
        },
        // 云雾飘动
        'cloud-drift': {
          '0%': { transform: 'translateX(-5%) translateY(0)' },
          '50%': { transform: 'translateX(5%) translateY(-3px)' },
          '100%': { transform: 'translateX(-5%) translateY(0)' },
        },
        // 笔触流动
        'brush-stroke': {
          '0%': { strokeDashoffset: '100%' },
          '100%': { strokeDashoffset: '0%' },
        },
        // 光晕扩散
        'aura-spread': {
          '0%': { transform: 'scale(0.95)', opacity: '0.6' },
          '50%': { transform: 'scale(1.05)', opacity: '0.3' },
          '100%': { transform: 'scale(0.95)', opacity: '0.6' },
        },
        // 入场动画
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // 墨滴落下
        'ink-drop': {
          '0%': { transform: 'scaleY(0)', opacity: '0' },
          '30%': { transform: 'scaleY(1.2)', opacity: '1' },
          '60%': { transform: 'scaleY(0.9)', opacity: '0.8' },
          '100%': { transform: 'scaleY(1)', opacity: '1' },
        },
        // 器灵眨眼/表情切换
        'spirit-blink': {
          '0%, 96%, 98%, 100%': { transform: 'scaleY(1)' },
          '97%, 99%': { transform: 'scaleY(0.05)' },
        },
      },
      animation: {
        progress: 'progress 1.5s infinite ease-in-out',
        'spirit-float': 'spirit-float 5s ease-in-out infinite',
        'spirit-breathe': 'spirit-breathe 3.5s ease-in-out infinite',
        'spirit-glow-pulse': 'spirit-glow-pulse 4s ease-in-out infinite',
        'cloud-drift': 'cloud-drift 12s ease-in-out infinite',
        'brush-stroke': 'brush-stroke 2s ease forwards',
        'aura-spread': 'aura-spread 4s ease-in-out infinite',
        'fade-in-up': 'fade-in-up 0.4s ease-out',
        'ink-drop': 'ink-drop 0.4s ease-out',
        'spirit-blink': 'spirit-blink 4s ease-in-out infinite',
      },
      fontFamily: {
        brush: ['"Ma Shan Zheng"', '"ZCOOL KuaiLe"', '"Liu Jian Mao Cao"', 'cursive'],
        serif: ['"Noto Serif SC"', '"Source Han Serif SC"', 'serif'],
      },
    },
  },
} as Config;
