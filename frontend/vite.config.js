import fs from "node:fs"
import path from "path"
import { execSync } from "node:child_process"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { visualizer } from "rollup-plugin-visualizer"
import { createPrivateProxyLogger } from "./scripts/private-proxy-logger.mjs"

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
  const releaseCommit = process.env.HMS_BUILD_SHA
  if (releaseCommit && (releaseCommit.length !== 40 || !/^[a-f0-9]{40}$/.test(releaseCommit))) {
    throw new Error("HMS_BUILD_SHA must be a full lowercase Git commit SHA")
  }
  const buildInfo = {
    version: packageJson.version,
    commit:
      releaseCommit || process.env.VERCEL_GIT_COMMIT_SHA ||
      readGitValue("git rev-parse HEAD"),
    branch: releaseCommit ? null :
      process.env.VERCEL_GIT_COMMIT_REF ||
      readGitValue("git rev-parse --abbrev-ref HEAD"),
    builtAt: new Date().toISOString(),
    mode,
  }

  return {
    customLogger: createPrivateProxyLogger(),
    define: {
      "globalThis.__HMS_STATIC_BUILD_INFO__": JSON.stringify(buildInfo),
    },
    plugins: [
      {
        name: "hms-build-provenance",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "build-info.json",
            source: JSON.stringify(buildInfo) + "\n",
          })
        },
      },
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
            if (
              id.includes("clsx") ||
              id.includes("tailwind-merge") ||
              id.includes("class-variance-authority")
            ) return "vendor-ui-utils"
            if (id.includes("zrender")) return "vendor-zrender"
            if (id.includes("echarts")) return "vendor-echarts"
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
        "/api/v2": {
          target: process.env.VITE_V2_API_PROXY_TARGET || "http://localhost:8080",
          changeOrigin: true,
        },
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
    preview: {
      proxy: {
        "/api/v2": {
          target: process.env.VITE_V2_API_PROXY_TARGET || "http://localhost:8080",
          changeOrigin: true,
        },
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
  }
})
