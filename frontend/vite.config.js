import fs from "node:fs"
import path from "path"
import { execSync } from "node:child_process"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { visualizer } from "rollup-plugin-visualizer"

function readGitValue(command, fallback = null) {
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || fallback
  } catch {
    return fallback
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const analyze = mode === "analyze" || process.env.ANALYZE === "true"
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"))
  const buildInfo = {
    version: packageJson.version,
    commit:
      process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ||
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
      readGitValue("git rev-parse --short HEAD"),
    branch:
      process.env.RAILWAY_GIT_BRANCH ||
      process.env.VERCEL_GIT_COMMIT_REF ||
      readGitValue("git rev-parse --abbrev-ref HEAD"),
    builtAt: new Date().toISOString(),
    mode,
  }

  return {
    define: {
      "globalThis.__HMS_STATIC_BUILD_INFO__": JSON.stringify(buildInfo),
    },
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
      rollupOptions: {
        output: {
          // Keep React + Radix in one chunk to prevent cross-chunk circular init issues
          // while still splitting large optional dependencies for startup performance.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined
            if (
              id.includes("react-dom") ||
              id.includes("react/") ||
              id.includes("@radix-ui") ||
              id.includes("@floating-ui") ||
              id.includes("react-remove-scroll")
            ) return "vendor-core"
            if (id.includes("react-router")) return "vendor-router"
            if (id.includes("@tanstack/react-query") || id.includes("@tanstack/query-core")) return "vendor-query"
            if (id.includes("recharts") || id.includes("react-smooth") || id.includes("d3-")) return "vendor-recharts"
            if (id.includes("@dnd-kit")) return "vendor-dnd"
            if (id.includes("date-fns")) return "vendor-date"
            if (id.includes("react-hook-form") || id.includes("@hookform/resolvers") || id.includes("zod")) return "vendor-form"
            if (id.includes("react-day-picker")) return "vendor-day-picker"
            if (id.includes("react-resizable-panels")) return "vendor-panels"
            if (id.includes("sonner")) return "vendor-sonner"
            if (id.includes("lodash")) return "vendor-lodash"
            return undefined
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
