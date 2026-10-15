import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/v1": "http://127.0.0.1:4318",
      "/health": "http://127.0.0.1:4318",
    },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1100 },
});
