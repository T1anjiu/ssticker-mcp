import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/admin/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3377",
      "/assets": "http://127.0.0.1:3377"
    }
  },
  build: {
    sourcemap: true,
    target: "es2022"
  }
});
