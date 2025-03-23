/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1E3A8A',
          50: '#E6EBF4',
          100: '#C2D1E8',
          200: '#9AB3DB',
          300: '#7295CE',
          400: '#4A77C1',
          500: '#3B62A4',
          600: '#2C4D87',
          700: '#1E3A8A',
          800: '#15276D',
          900: '#0C1550',
        },
        secondary: {
          DEFAULT: '#3B82F6',
          50: '#EBF2FE',
          100: '#D7E6FD',
          200: '#B0CDFB',
          300: '#88B4F9',
          400: '#619BF8',
          500: '#3B82F6',
          600: '#0B61EF',
          700: '#084BBB',
          800: '#063587',
          900: '#042054',
        },
        accent: {
          DEFAULT: '#10B981',
          50: '#E7F9F4',
          100: '#D0F4E9',
          200: '#A1E9D2',
          300: '#72DFBC',
          400: '#43D4A5',
          500: '#10B981',
          600: '#0D9267',
          700: '#096C4D',
          800: '#064733',
          900: '#03211A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
