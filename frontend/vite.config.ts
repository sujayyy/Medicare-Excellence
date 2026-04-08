import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
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
