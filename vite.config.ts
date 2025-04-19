import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"

export default defineConfig({
  plugins: [nodePolyfills({ protocolImports: true })].filter(Boolean),
  base: "/",
  server: {
    port: 3000,
  },
})
