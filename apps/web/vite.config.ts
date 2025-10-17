import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindVite from "@tailwindcss/vite";
import tailwindPostcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";

export default defineConfig({
  plugins: [react(), tailwindVite()],
  css: {
    postcss: {
      plugins: [tailwindPostcss(), autoprefixer()],
    },
  },
});
