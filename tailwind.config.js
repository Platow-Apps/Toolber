/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Motorsport direction — see docs/feature-checklist.md "UI reference baseline locked"
        asphalt: "#16181B",
        panel: "#232629",
        panelBorder: "#33373C",
        page: "#ECEAE4",
        cardBorder: "#D8D5CC",
        safety: "#F2B90B", // brand accent — active states, primary CTA text
        redOrange: "#E8491F", // "Toolber" wordmark specifically
        signal: "#E1382D", // crib pins, danger/malfunction
        racing: "#2878B8", // group pins, industrial category
        attention: "#F2790B", // orange notification dots — awaiting-your-attention, not a problem
        steel: "#7C8087",
        steelLight: "#B7BCC2",
        ink: "#4A4C48",
        muted: "#8B8D89",
      },
      fontFamily: {
        condensed: ["Rajdhani", "Arial Narrow", "sans-serif"],
        sans: ["IBM Plex Sans", "-apple-system", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
}
