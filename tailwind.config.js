/** @type {import('tailwindcss').Config} */
/* eslint-env node */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "node_modules/flowbite-react/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {}
  },
  plugins: [require("flowbite/plugin")]
}
