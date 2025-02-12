import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import resolve from "vite-plugin-resolve"

const aztecVersion = "0.75.0"

export default defineConfig({
  plugins: [
    process.env.NODE_ENV === "production"
      ? /** @type {any} */ resolve({
          "@aztec/bb.js": `export * from "https://unpkg.com/@aztec/bb.js@${aztecVersion}/dest/browser/index.js"`,
        })
      : undefined,
    nodePolyfills({ protocolImports: true }),
  ].filter(Boolean),
  base: "/",
  server: {
    port: 3000,
  },
})
