import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: {
      // Dev mode proxies API calls to the Go server.
      "/api": "http://127.0.0.1:7333",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
