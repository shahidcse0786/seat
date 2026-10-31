/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        seat: {
          bg: "#0B0F14",
          panel: "#111720",
          border: "#1E293B",
          accent: "#38BDF8",
          accent2: "#22D3EE",
          muted: "#94A3B8",
          success: "#10B981",
          warn: "#F59E0B",
          danger: "#EF4444",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
