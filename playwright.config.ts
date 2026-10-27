import { defineConfig, devices } from "@playwright/test"

const PORT = 3210
export const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: "e2e",
  // Measurements must not compete with each other for CPU
  workers: 1,
  fullyParallel: false,
  timeout: 10 * 60 * 1000,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    ...devices["Desktop Chrome"],
  },
  // Own port and never reused: measuring a running `bun dev` would give dev-mode numbers
  webServer: {
    command: `bun run build && bun run start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 5 * 60 * 1000,
  },
})
