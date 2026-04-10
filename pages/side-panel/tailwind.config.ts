import baseConfig from '@extension/tailwindcss-config';
import type { Config } from 'tailwindcss/types/config';

export default {
  ...baseConfig,
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 科幻主色调 - 青蓝色系
        cyber: {
          primary: '#00F0FF',
          secondary: '#7B68EE',
          accent: '#FF006E',
          glow: '#00D4FF',
          dark: '#0A0E17',
          surface: '#111827',
          card: '#1A1F2E',
          border: '#1E3A5F',
          muted: '#4B5563',
        },
        // 光模式配色
        neon: {
          sky: '#0EA5E9',
          blue: '#3B82F6',
          purple: '#8B5CF6',
          pink: '#EC4899',
        },
      },
      backgroundImage: {
        // 科幻渐变背景
        'cyber-gradient': 'linear-gradient(135deg, #0A0E17 0%, #1A1F2E 50%, #0F172A 100%)',
        'cyber-gradient-light': 'linear-gradient(135deg, #F0F9FF 0%, #E0F2FE 50%, #F8FAFC 100%)',
        'cyber-glow': 'radial-gradient(ellipse at center, rgba(0, 240, 255, 0.15) 0%, transparent 70%)',
        'cyber-glow-light': 'radial-gradient(ellipse at center, rgba(14, 165, 233, 0.10) 0%, transparent 70%)',
        // 发光边框渐变
        'border-glow': 'linear-gradient(90deg, #00F0FF, #7B68EE, #00F0FF)',
        'border-glow-light': 'linear-gradient(90deg, #0EA5E9, #3B82F6, #0EA5E9)',
        // 按钮渐变
        'btn-cyber': 'linear-gradient(135deg, #00F0FF 0%, #0099CC 100%)',
        'btn-cyber-light': 'linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%)',
      },
      boxShadow: {
        // 科幻发光阴影
        'cyber-sm': '0 0 15px rgba(0, 240, 255, 0.3), 0 2px 8px rgba(0, 0, 0, 0.3)',
        'cyber-md': '0 0 20px rgba(0, 240, 255, 0.4), 0 4px 16px rgba(0, 0, 0, 0.4)',
        'cyber-lg': '0 0 30px rgba(0, 240, 255, 0.5), 0 8px 24px rgba(0, 0, 0, 0.5)',
        'cyber-inset': 'inset 0 0 20px rgba(0, 240, 255, 0.1)',
        'cyber-sm-light': '0 0 12px rgba(14, 165, 233, 0.25), 0 2px 6px rgba(0, 0, 0, 0.08)',
        'cyber-md-light': '0 0 18px rgba(14, 165, 233, 0.35), 0 4px 12px rgba(0, 0, 0, 0.12)',
        // 玻璃态阴影
        glass: '0 8px 32px rgba(0, 0, 0, 0.12)',
        'glass-dark': '0 8px 32px rgba(0, 0, 0, 0.4)',
      },
      keyframes: {
        progress: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        // 科幻动画
        'cyber-pulse': {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 20px rgba(0, 240, 255, 0.4)' },
          '50%': { opacity: '0.8', boxShadow: '0 0 40px rgba(0, 240, 255, 0.8)' },
        },
        'cyber-glow': {
          '0%, 100%': { boxShadow: '0 0 5px rgba(0, 240, 255, 0.3)' },
          '50%': { boxShadow: '0 0 20px rgba(0, 240, 255, 0.6), 0 0 40px rgba(0, 240, 255, 0.3)' },
        },
        'border-flow': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'scan-line': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        progress: 'progress 1.5s infinite ease-in-out',
        'cyber-pulse': 'cyber-pulse 2s ease-in-out infinite',
        'cyber-glow': 'cyber-glow 3s ease-in-out infinite',
        'border-flow': 'border-flow 3s linear infinite',
        float: 'float 3s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
        'scan-line': 'scan-line 4s linear infinite',
        'fade-in-up': 'fade-in-up 0.4s ease-out',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
} as Config;
