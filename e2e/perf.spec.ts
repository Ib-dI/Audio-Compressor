import { expect, test, type Browser, type Page } from "@playwright/test"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BASE_URL } from "../playwright.config"

// Each measurement is the median of RUNS tries, to absorb CI runner noise
const RUNS = 3
const FIXTURE = path.join(__dirname, "fixtures", "voix-reference.wav")

const PRESETS = {
  ultra:   { button: /^Ultra léger/, sampleRate: 12000, channels: 1 },
  light:   { button: /^Léger/,       sampleRate: 16000, channels: 1 },
  medium:  { button: /^Moyen/,       sampleRate: 22050, channels: 1 },
  quality: { button: /^Qualité/,     sampleRate: 44100, channels: 2 },
} as const
type PresetKey = keyof typeof PRESETS

interface PerfResults {
  loadMs: number
  jsBytes: number
  compressMs: Record<PresetKey, number>
}

interface PerfBudget {
  tolerance: number
  budget: {
    loadMs: number | null
    jsBytes: number | null
    compressMs: Record<PresetKey, number | null>
  }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// Vorbis identification header: "\x01vorbis", version (u32), channels (u8), sample rate (u32 LE)
function readVorbisHeader(bytes: Uint8Array) {
  const magic = new TextDecoder().decode(bytes.subarray(0, 4))
  const idx = Buffer.from(bytes).indexOf("\x01vorbis", 0, "latin1")
  if (magic !== "OggS" || idx === -1) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset + idx + 7)
  return { channels: view.getUint8(4), sampleRate: view.getUint32(5, true) }
}

async function waitForFFmpeg(page: Page) {
  await expect(page.getByText("Chargement FFmpeg…")).toHaveCount(0, { timeout: 2 * 60 * 1000 })
  await expect(page.getByText(/Erreur FFmpeg/)).toHaveCount(0)
}

// Cold load in a fresh context: no cache, so the wasm is fetched every time
async function measureLoad(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const scriptSizes: Promise<number>[] = []
  page.on("response", response => {
    const sameOrigin = response.url().startsWith(BASE_URL)
    if (sameOrigin && response.request().resourceType() === "script") {
      scriptSizes.push(response.body().then(b => b.length, () => 0))
    }
  })

  const start = Date.now()
  await page.goto("/")
  await waitForFFmpeg(page)
  const loadMs = Date.now() - start

  const jsBytes = (await Promise.all(scriptSizes)).reduce((a, b) => a + b, 0)
  await context.close()
  return { loadMs, jsBytes }
}

test("performance et sortie de la compression", async ({ browser, page }) => {
  const loads = []
  for (let i = 0; i < RUNS; i++) loads.push(await measureLoad(browser))

  await page.goto("/")
  await waitForFFmpeg(page)

  const inputSize = statSync(FIXTURE).size
  const downloads = page.locator('a[download$=".ogg"]')
  const compressMs = {} as Record<PresetKey, number>
  let compressed = 0

  for (const [key, preset] of Object.entries(PRESETS) as [PresetKey, (typeof PRESETS)[PresetKey]][]) {
    await page.getByRole("button", { name: preset.button }).click()

    const times = []
    for (let i = 0; i < RUNS; i++) {
      await page.locator('input[type="file"]').setInputFiles(FIXTURE)
      const start = Date.now()
      await page.getByRole("button", { name: /^Compresser/ }).click()
      compressed++
      await expect(downloads).toHaveCount(compressed, { timeout: 2 * 60 * 1000 })
      times.push(Date.now() - start)
    }
    compressMs[key] = median(times)

    // The output must be a valid Ogg Vorbis file matching the preset, and smaller than the input
    const href = await downloads.last().getAttribute("href")
    const bytes = new Uint8Array(await page.evaluate(async url => {
      const buffer = await (await fetch(url!)).arrayBuffer()
      return Array.from(new Uint8Array(buffer))
    }, href))
    expect(bytes.length, `${key} : sortie plus petite que l'entrée`).toBeLessThan(inputSize)
    expect(readVorbisHeader(bytes), `${key} : en-tête Ogg Vorbis`).toEqual({
      channels: preset.channels,
      sampleRate: preset.sampleRate,
    })
  }

  const results: PerfResults = {
    loadMs: median(loads.map(l => l.loadMs)),
    jsBytes: loads[0].jsBytes,
    compressMs,
  }
  writeFileSync("perf-results.json", JSON.stringify(results, null, 2) + "\n")
  console.log(JSON.stringify(results, null, 2))

  // A null budget is not enforced yet: it gets set from a first CI measurement
  const { tolerance, budget }: PerfBudget = JSON.parse(readFileSync("perf-budget.json", "utf8"))
  const check = (name: string, measured: number, limit: number | null) => {
    if (limit === null) return
    expect.soft(measured, `${name} : ${measured} > budget ${limit} (+${tolerance * 100} %)`)
      .toBeLessThanOrEqual(limit * (1 + tolerance))
  }
  check("loadMs", results.loadMs, budget.loadMs)
  check("jsBytes", results.jsBytes, budget.jsBytes)
  for (const key of Object.keys(PRESETS) as PresetKey[]) {
    check(`compressMs.${key}`, compressMs[key], budget.compressMs[key])
  }
})
