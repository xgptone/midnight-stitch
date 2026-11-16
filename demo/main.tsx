import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MidnightStitch } from "../src"

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found")

createRoot(root).render(
    <StrictMode>
        <MidnightStitch />
    </StrictMode>
)
