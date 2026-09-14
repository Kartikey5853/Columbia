module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        sand: "#f5f0e7",
        ember: "#ff6b35",
        moss: "#0f766e",
        sky: "#c7d2fe"
      },
      boxShadow: {
        card: "0 24px 60px rgba(15, 23, 42, 0.18)"
      }
    }
  },
  plugins: []
};
