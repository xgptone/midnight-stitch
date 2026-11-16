import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
    plugins: [react()],
    // Relative base keeps the demo deployable to GitHub Pages sub-paths.
    base: "./",
})
