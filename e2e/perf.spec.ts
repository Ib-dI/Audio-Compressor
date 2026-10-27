import { expect, test, type Browser, type Page } from "@playwright/test"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BASE_URL } from "../playwright.config"

// Each measurement is the median of RUNS tries, to absorb CI runner noise
const RUNS = 5
const FIXTURE = path.join(__dirname, "fixtures", "voix-reference.wav")

const PRESETS = {
  ultra:   { button: /^Ultra léger/, sampleRate: 12000, channels: 1 },
  light:   { button: /^Léger/,       sampleRate: 16000, channels: 1 },
  medium:  { button: /^Moyen/,       sampleRate: 22050, channels: 1 },
  quality: { button: /^Qualité/,     sampleRate: 44100, channels: 2 },
} as const
type PresetKey = keyof typeof PRESETS

// Compression times depend on the runner's CPU, so in CI they are compared with
// the base branch built and measured on the same runner (BASELINE_URL)
const BASELINE_URL = process.env.BASELINE_URL

interface PerfResults {
  loadMs: number
  jsBytes: number
  compressMs: Record<PresetKey, number>
  baselineCompressMs?: Record<PresetKey, number>
}

interface Limit {
  max: number | null
  tolerance: number
}

interface PerfBudget {
  loadMs: Limit
  jsBytes: Limit
  compressVsBaseline: { tolerance: number }
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

// Times are taken inside the page on every frame: Playwright's own polling
// (100 ms to 1 s) would be coarser than what we measure
async function pageNow(page: Page) {
  return page.evaluate(() => performance.now())
}

const PAGE_WAIT = { polling: "raf", timeout: 2 * 60 * 1000 } as const

// Returns the time since navigation start at which FFmpeg became ready
async function waitForFFmpeg(page: Page) {
  const handle = await page.waitForFunction(
    () => document.body.textContent?.includes("Chargement FFmpeg…") ? null : performance.now(),
    undefined,
    PAGE_WAIT
  )
  await expect(page.getByText(/Erreur FFmpeg/)).toHaveCount(0)
  return handle.jsonValue() as Promise<number>
}

async function waitForDownloads(page: Page, count: number) {
  const handle = await page.waitForFunction(
    n => document.querySelectorAll('a[download$=".ogg"]').length >= n ? performance.now() : null,
    count,
    PAGE_WAIT
  )
  return handle.jsonValue() as Promise<number>
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

  await page.goto("/")
  const loadMs = await waitForFFmpeg(page)

  const jsBytes = (await Promise.all(scriptSizes)).reduce((a, b) => a + b, 0)
  await context.close()
  return { loadMs, jsBytes }
}

// An app page with FFmpeg loaded, compressing the fixture one file at a time
async function openCompressor(page: Page, url: string) {
  await page.goto(url)
  await waitForFFmpeg(page)
  let compressed = 0

  return {
    page,
    selectPreset: (key: PresetKey) => page.getByRole("button", { name: PRESETS[key].button }).click(),
    async compress() {
      await page.locator('input[type="file"]').setInputFiles(FIXTURE)
      const start = await pageNow(page)
      await page.getByRole("button", { name: /^Compresser/ }).click()
      compressed++
      return (await waitForDownloads(page, compressed)) - start
    },
  }
}

test("performance et sortie de la compression", async ({ browser, page }) => {
  const loads = []
  for (let i = 0; i < RUNS; i++) loads.push(await measureLoad(browser))

  const app = await openCompressor(page, "/")
  const baseline = BASELINE_URL ? await openCompressor(await browser.newPage(), BASELINE_URL) : null

  const inputSize = statSync(FIXTURE).size
  const compressMs = {} as Record<PresetKey, number>
  const baselineCompressMs = {} as Record<PresetKey, number>

  for (const [key, preset] of Object.entries(PRESETS) as [PresetKey, (typeof PRESETS)[PresetKey]][]) {
    await app.selectPreset(key)
    await baseline?.selectPreset(key)

    // Alternate which side goes first, so drift in the runner's speed hits both equally
    const times: number[] = []
    const baselineTimes: number[] = []
    for (let i = 0; i < RUNS; i++) {
      if (baseline && i % 2 === 1) baselineTimes.push(await baseline.compress())
      times.push(await app.compress())
      if (baseline && i % 2 === 0) baselineTimes.push(await baseline.compress())
    }
    compressMs[key] = Math.round(median(times))
    if (baseline) baselineCompressMs[key] = Math.round(median(baselineTimes))

    // The output must be a valid Ogg Vorbis file matching the preset, and smaller than the input
    const href = await page.locator('a[download$=".ogg"]').last().getAttribute("href")
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
    loadMs: Math.round(median(loads.map(l => l.loadMs))),
    jsBytes: loads[0].jsBytes,
    compressMs,
    ...(baseline && { baselineCompressMs }),
  }
  writeFileSync("perf-results.json", JSON.stringify(results, null, 2) + "\n")
  console.log(JSON.stringify(results, null, 2))

  // A null max is not enforced yet: it gets set from a first CI measurement
  const budget: PerfBudget = JSON.parse(readFileSync("perf-budget.json", "utf8"))
  const check = (name: string, measured: number, limit: number | null, tolerance: number) => {
    if (limit === null) return
    expect.soft(measured, `${name} : ${measured} > ${limit} (+${tolerance * 100} %)`)
      .toBeLessThanOrEqual(limit * (1 + tolerance))
  }
  check("loadMs", results.loadMs, budget.loadMs.max, budget.loadMs.tolerance)
  check("jsBytes", results.jsBytes, budget.jsBytes.max, budget.jsBytes.tolerance)
  if (baseline) {
    for (const key of Object.keys(PRESETS) as PresetKey[]) {
      check(`compressMs.${key} vs base`, compressMs[key], baselineCompressMs[key], budget.compressVsBaseline.tolerance)
    }
  }
})
