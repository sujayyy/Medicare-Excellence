import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    allowedHosts: [
      "sasha-decidual-cagily.ngrok-free.dev",
    ],
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5001",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react_vendor: ["react", "react-dom", "react-router-dom"],
          query_vendor: ["@tanstack/react-query"],
          charts_vendor: ["recharts", "framer-motion"],
          markdown_vendor: ["react-markdown"],
          ui_vendor: ["lucide-react", "@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-toast"],
        },
      },
    },
  },
}));
