import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Preserve the browser Host so the API's same-origin check also works in dev.
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: false },
      "/mcp": { target: "http://127.0.0.1:3001", changeOrigin: false },
    },
  },
});
