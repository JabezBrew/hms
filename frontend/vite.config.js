import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { visualizer } from "rollup-plugin-visualizer"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const analyze = mode === "analyze" || process.env.ANALYZE === "true"

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(analyze
        ? [
            visualizer({
              filename: "dist/stats.html",
              template: "treemap",
              gzipSize: true,
              brotliSize: true,
              open: false,
            }),
          ]
        : []),
    ],
    build: {
      modulePreload: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react-dom") || id.includes("react/")) return "vendor-react"
            if (id.includes("react-router")) return "vendor-router"
            if (id.includes("@tanstack/react-query") || id.includes("@tanstack/query-core")) return "vendor-query"
            if (id.includes("recharts") || id.includes("react-smooth") || id.includes("d3-")) return "vendor-recharts"
            if (id.includes("@dnd-kit")) return "vendor-dnd"
            if (id.includes("date-fns")) return "vendor-date"
            if (id.includes("react-hook-form") || id.includes("@hookform/resolvers")) return "vendor-form"
            if (id.includes("zod")) return "vendor-zod"
            if (id.includes("react-day-picker")) return "vendor-day-picker"
            if (id.includes("react-resizable-panels")) return "vendor-panels"
            if (id.includes("sonner")) return "vendor-sonner"
            if (id.includes("lodash")) return "vendor-lodash"
            if (
              id.includes("@radix-ui") ||
              id.includes("@floating-ui") ||
              id.includes("react-remove-scroll")
            ) return "vendor-radix"
            return undefined
          }
        },
      },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    optimizeDeps: {
      exclude: ["lucide-react", "lucide-react/dist/esm/icons"],
    },
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
    preview: {
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
  }
})
