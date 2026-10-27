"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import Image from "next/image";
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { ThemeToggle } from "@/components/theme-toggle"
import { FFmpeg } from "@ffmpeg/ffmpeg"
import { fetchFile } from "@ffmpeg/util"
import { motion, AnimatePresence, MotionConfig } from "framer-motion"
import {
  CheckCircle2,
  Download,
  FileAudio,
  Upload,
  X,
  Trash2,
  AlertCircle,
  Loader2,
  Check,
} from "lucide-react"
import React, { useEffect, useRef, useState } from "react"

interface PresetConfig { 
  bitrate: number
  sampleRate: number
  channels: 1 | 2
  label: string
  description: string
}

type PresetKey = "ultra" | "light" | "medium" | "quality" | "custom"

const PRESETS: Record<PresetKey, PresetConfig> = {
  ultra:   { bitrate: 16, sampleRate: 12000, channels: 1, label: "Ultra léger", description: "Voix" },
  light:   { bitrate: 32, sampleRate: 16000, channels: 1, label: "Léger",       description: "Podcast" },
  medium:  { bitrate: 64, sampleRate: 22050, channels: 1, label: "Moyen",       description: "Radio" },
  quality: { bitrate: 96, sampleRate: 44100, channels: 2, label: "Qualité",     description: "Musique" },
  custom:  { bitrate: 32, sampleRate: 16000, channels: 1, label: "Personnalisé", description: "Sur mesure" },
}

const CDN_CONFIGS = [
  {
    coreURL: "https://unpkg.com/@ffmpeg/core@0.12.4/dist/umd/ffmpeg-core.js",
    wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.4/dist/umd/ffmpeg-core.wasm",
  },
  {
    coreURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.4/dist/umd/ffmpeg-core.js",
    wasmURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.4/dist/umd/ffmpeg-core.wasm",
  },
  {
    coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
    wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
  },
]

interface AudioFile {
  id: string
  file: File
  originalSize: number
  compressedSize: number | null
  compressedUrl: string | null
  progress: number
  status: "pending" | "compressing" | "completed" | "error"
  error: string | null
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

export default function AudioCompressor() {
  const [files, setFiles] = useState<AudioFile[]>([])
  const [isCompressing, setIsCompressing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [preset, setPreset] = useState<PresetKey>("light")
  const [bitrate, setBitrate] = useState(32)
  const [sampleRate, setSampleRate] = useState(16000)
  const [channels, setChannels] = useState<1 | 2>(1)
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ffmpegRef = useRef<FFmpeg | null>(null)

  const loadFFmpeg = async (ffmpeg: FFmpeg) => {
    try {
      let lastError: unknown = null
      for (const config of CDN_CONFIGS) {
        try {
          await ffmpeg.load(config)
          setFfmpegLoaded(true)
          return
        } catch (err) {
          lastError = err
        }
      }
      throw lastError ?? new Error("Impossible de charger FFmpeg depuis aucun CDN")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setGlobalError("Erreur FFmpeg : " + message)
    }
  }

  useEffect(() => {
    // The ref survives Strict Mode's remount, so FFmpeg is only loaded once
    if (!ffmpegRef.current) {
      ffmpegRef.current = new FFmpeg()
      loadFFmpeg(ffmpegRef.current)
    }
    return () => {
      setFiles(prev => {
        prev.forEach(f => { if (f.compressedUrl) URL.revokeObjectURL(f.compressedUrl) })
        return prev
      })
    }
  }, [])

  const handlePresetChange = (value: string) => {
    const key = value as PresetKey
    setPreset(key)
    if (key !== "custom") {
      setBitrate(PRESETS[key].bitrate)
      setSampleRate(PRESETS[key].sampleRate)
      setChannels(PRESETS[key].channels)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("audio/"))
    if (dropped.length > 0) addFiles(dropped)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : []
    if (selected.length > 0) addFiles(selected)
    e.target.value = ""
  }

  const addFiles = (newFiles: File[]) => {
    const audioFiles: AudioFile[] = newFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      originalSize: file.size,
      compressedSize: null,
      compressedUrl: null,
      progress: 0,
      status: "pending",
      error: null,
    }))
    setFiles(prev => [...prev, ...audioFiles])
    setGlobalError(null)
  }

  const removeFile = (id: string) => {
    setFiles(prev => {
      const f = prev.find(f => f.id === id)
      if (f?.compressedUrl) URL.revokeObjectURL(f.compressedUrl)
      return prev.filter(f => f.id !== id)
    })
  }

  const clearAll = () => {
    setFiles(prev => {
      prev.forEach(f => { if (f.compressedUrl) URL.revokeObjectURL(f.compressedUrl) })
      return []
    })
  }

  const compressFile = async (audioFile: AudioFile) => {
    const ffmpeg = ffmpegRef.current!
    const ext = audioFile.file.name.substring(audioFile.file.name.lastIndexOf(".")) || ".audio"
    const inputName = `input_${audioFile.id}${ext}`
    const outputName = `output_${audioFile.id}.ogg`

    try {
      setFiles(prev => prev.map(f =>
        f.id === audioFile.id ? { ...f, status: "compressing", progress: 5 } : f
      ))

      const onProgress = ({ progress }: { progress: number }) => {
        setFiles(prev => prev.map(f =>
          f.id === audioFile.id ? { ...f, progress: Math.min(95, Math.round(5 + progress * 90)) } : f
        ))
      }
      ffmpeg.on("progress", onProgress)

      await ffmpeg.writeFile(inputName, await fetchFile(audioFile.file))
      await ffmpeg.exec([
        "-i", inputName,
        "-vn",
        "-map", "0:a",
        "-c:a", "libvorbis",
        "-ac", channels.toString(),
        "-ar", sampleRate.toString(),
        "-b:a", `${bitrate}k`,
        "-compression_level", "10",
        outputName,
      ])

      ffmpeg.off("progress", onProgress)

      const data = await ffmpeg.readFile(outputName)
      const byteData = data instanceof Uint8Array ? data : new TextEncoder().encode(data)
      const view = (byteData.byteOffset === 0 && byteData.byteLength === byteData.buffer.byteLength)
        ? byteData : byteData.slice()
      const blob = new Blob([view.buffer as ArrayBuffer], { type: "audio/ogg" })
      const url = URL.createObjectURL(blob)

      setFiles(prev => prev.map(f =>
        f.id === audioFile.id ? { ...f, compressedUrl: url, compressedSize: blob.size, progress: 100, status: "completed" } : f
      ))
    } catch (err) {
      ffmpeg.off("progress", () => {})
      const message = err instanceof Error ? err.message : String(err)
      setFiles(prev => prev.map(f =>
        f.id === audioFile.id ? { ...f, status: "error", error: message, progress: 0 } : f
      ))
    } finally {
      try { await ffmpeg.deleteFile(inputName) } catch { /* ignore */ }
      try { await ffmpeg.deleteFile(outputName) } catch { /* ignore */ }
    }
  }

  const handleCompressAll = async () => {
    if (!ffmpegLoaded) { setGlobalError("FFmpeg n'est pas encore chargé, veuillez patienter..."); return }
    if (files.length === 0) { setGlobalError("Veuillez ajouter au moins un fichier audio"); return }

    setIsCompressing(true)
    setGlobalError(null)
    for (const file of files.filter(f => f.status === "pending" || f.status === "error")) {
      await compressFile(file)
    }
    setIsCompressing(false)
  }

  const downloadAll = () => {
    files.filter(f => f.compressedUrl).forEach((file, i) => {
      setTimeout(() => {
        const a = document.createElement("a")
        a.href = file.compressedUrl!
        a.download = `${file.file.name.replace(/\.[^/.]+$/, "")}-v2.ogg`
        a.click()
      }, i * 200)
    })
  }

  const totalOriginal = files.reduce((s, f) => s + f.originalSize, 0)
  const totalCompressed = files.reduce((s, f) => s + (f.compressedSize ?? 0), 0)
  const completedCount = files.filter(f => f.status === "completed").length
  const pendingCount = files.filter(f => f.status === "pending" || f.status === "error").length
  const savings = totalCompressed > 0 ? Math.round((1 - totalCompressed / totalOriginal) * 100) : 0

  const formatRate = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`)
  const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
  const hasFiles = files.length > 0

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: EASE_OUT }}>
    <div className="flex min-h-dvh flex-col">
      {/* N9 · edge-aligned: wordmark left, engine status + theme right */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className={`flex items-center gap-2.5 rounded-md ${focusRing}`}>
            <Image src="/audio_compressor.png" alt="" width={28} height={18} />
            <span className="whitespace-nowrap font-display text-[15px] font-semibold tracking-tight">Audio Compressor</span>
          </Link>
          <div className="flex items-center gap-3">
            <span role="status" className="hidden items-center gap-2 font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground sm:inline-flex">
              <span className={`size-1.5 rounded-full ${ffmpegLoaded ? "bg-success" : "animate-pulse bg-muted-foreground"}`} />
              {ffmpegLoaded ? "FFmpeg prêt" : "Chargement FFmpeg…"}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-10 sm:px-6 sm:pt-12">
        <h1 className="min-w-0 font-display text-[clamp(1.875rem,2.5vw+1rem,2.625rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-balance wrap-anywhere">
          Compressez vos audios sans les envoyer.
        </h1>
        <p className="mt-3 max-w-[56ch] leading-relaxed text-muted-foreground text-pretty">
          La conversion tourne dans votre navigateur, avec FFmpeg compilé en WebAssembly.
          Vos fichiers ne quittent jamais votre machine.
        </p>

        <div className="mt-8 space-y-4">
          {/* 1 · Drop */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Ajouter des fichiers audio"
            aria-describedby="formats"
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click() }
            }}
            className={`group flex cursor-pointer items-center gap-4 rounded-xl border border-dashed px-5 transition-[background-color,border-color] duration-150 ${focusRing}
              ${hasFiles ? "py-4" : "py-8 sm:py-10"}
              ${isDragging
                ? "border-signal bg-signal/5"
                : "border-input bg-card hover:border-foreground/60 hover:bg-muted/50"
              }`}
          >
            <input ref={fileInputRef} type="file" accept="audio/*" multiple onChange={handleFileSelect} className="hidden" />
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background transition-colors duration-150 ${isDragging ? "border-signal text-signal" : "border-border text-muted-foreground group-hover:text-foreground"}`}>
              <Upload className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {isDragging ? "Relâchez pour ajouter" : hasFiles ? "Ajouter d'autres fichiers" : "Déposez vos fichiers audio"}
              </p>
              <p id="formats" className="mt-0.5 text-xs text-muted-foreground">
                ou cliquez pour parcourir · MP3, WAV, OGG, M4A, FLAC
              </p>
            </div>
            <span className="hidden shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors duration-150 group-hover:border-foreground/25 sm:inline">
              Parcourir
            </span>
          </div>

          {/* 2 · Files */}
          <AnimatePresence initial={false}>
            {hasFiles && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="flex items-center justify-between border-b border-border py-2 pl-4 pr-2">
                  <h2 className="font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground tabular-nums">
                    {files.length} fichier{files.length > 1 ? "s" : ""}
                  </h2>
                  <Button variant="ghost" size="sm" onClick={clearAll} disabled={isCompressing} className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                    <Trash2 className="size-3" />
                    Tout effacer
                  </Button>
                </div>

                <ul className="max-h-96 divide-y divide-border overflow-y-auto">
                  <AnimatePresence initial={false}>
                    {files.map(audioFile => (
                      <motion.li
                        key={audioFile.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex size-4 shrink-0 items-center justify-center">
                            <AnimatePresence mode="popLayout" initial={false}>
                              <motion.span
                                key={audioFile.status}
                                initial={{ opacity: 0, scale: 0.6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.6 }}
                                className="flex"
                              >
                                {audioFile.status === "completed" && <CheckCircle2 className="size-4 text-success" />}
                                {audioFile.status === "error" && <AlertCircle className="size-4 text-destructive" />}
                                {audioFile.status === "compressing" && <Loader2 className="size-4 animate-spin text-signal" />}
                                {audioFile.status === "pending" && <FileAudio className="size-4 text-muted-foreground" />}
                              </motion.span>
                            </AnimatePresence>
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{audioFile.file.name}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-xs text-muted-foreground tabular-nums">
                              <span>{formatBytes(audioFile.originalSize)}</span>
                              {audioFile.compressedSize && (
                                <>
                                  <span aria-hidden>→</span>
                                  <span className="text-foreground">{formatBytes(audioFile.compressedSize)}</span>
                                  <span className="text-success">
                                    −{Math.round((1 - audioFile.compressedSize / audioFile.originalSize) * 100)}{" "}%
                                  </span>
                                </>
                              )}
                              {audioFile.status === "compressing" && <span>· {audioFile.progress}{" "}%</span>}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center">
                            {audioFile.status === "completed" && audioFile.compressedUrl && (
                              <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-foreground" asChild>
                                <a
                                  href={audioFile.compressedUrl}
                                  download={`${audioFile.file.name.replace(/\.[^/.]+$/, "")}-v2.ogg`}
                                  aria-label={`Télécharger ${audioFile.file.name}`}
                                >
                                  <Download className="size-4" />
                                </a>
                              </Button>
                            )}
                            {(audioFile.status === "pending" || audioFile.status === "error") && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="text-muted-foreground hover:text-foreground"
                                onClick={() => removeFile(audioFile.id)}
                                aria-label={`Retirer ${audioFile.file.name}`}
                              >
                                <X className="size-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {audioFile.status === "compressing" && (
                          <Progress
                            value={audioFile.progress}
                            aria-label={`Progression de ${audioFile.file.name}`}
                            className="mt-2.5 h-0.5 bg-border *:data-[slot=progress-indicator]:bg-signal"
                          />
                        )}

                        {audioFile.status === "error" && (
                          <p className="mt-2 pl-7 text-xs text-destructive text-pretty">{audioFile.error}</p>
                        )}

                        {audioFile.status === "completed" && audioFile.compressedUrl && (
                          <audio controls src={audioFile.compressedUrl} aria-label={`Écouter ${audioFile.file.name}`} className="mt-2.5 h-8 w-full" />
                        )}
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>

                {completedCount > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3">
                    <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs tabular-nums">
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Avant</dt>
                        <dd>{formatBytes(totalOriginal)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Après</dt>
                        <dd>{formatBytes(totalCompressed)}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Gain</dt>
                        <dd className="text-success">−{savings}{" "}%</dd>
                      </div>
                    </dl>
                    <Button onClick={downloadAll} variant="outline" size="sm" className="bg-card">
                      <Download className="size-3.5" />
                      Tout télécharger ({completedCount})
                    </Button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* 3 · Settings — presets on top, the real ffmpeg command as the card's footer band */}
          <section aria-labelledby="reglages" className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="p-4">
              <h2 id="reglages" className="font-display text-sm font-semibold tracking-tight">Qualité de sortie</h2>

              <div role="group" aria-label="Préréglage" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(Object.entries(PRESETS) as [PresetKey, PresetConfig][]).map(([key, p]) => {
                  const selected = preset === key
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => handlePresetChange(key)}
                      disabled={isCompressing}
                      className={`relative rounded-lg border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150 active:not-disabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}
                        ${key === "custom" ? "col-span-2 sm:col-span-1" : ""}
                        ${selected ? "border-signal bg-signal/5 ring-1 ring-signal" : "border-border hover:border-foreground/40 hover:bg-muted/60"}`}
                    >
                      <span className="block truncate text-sm font-medium">{p.label}</span>
                      {selected && (
                        <span aria-hidden className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-signal text-signal-foreground">
                          <Check className="size-2.5" strokeWidth={3} />
                        </span>
                      )}
                      <span className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-xs text-muted-foreground tabular-nums">
                        <span className="truncate">{p.description}</span>
                        {key !== "custom" && <span className="shrink-0">{p.bitrate}k</span>}
                      </span>
                    </button>
                  )
                })}
              </div>

              <AnimatePresence initial={false}>
                {preset === "custom" && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label id="debit-label" className="text-xs font-medium text-muted-foreground">Débit</label>
                          <span className="font-mono text-xs tabular-nums">{bitrate} kb/s</span>
                        </div>
                        <Slider value={[bitrate]} onValueChange={v => setBitrate(v[0])} min={16} max={192} step={8} aria-labelledby="debit-label" className="w-full" />
                      </div>

                      <div className="min-w-0 space-y-2">
                        <label htmlFor="frequence" className="text-xs font-medium text-muted-foreground">Fréquence</label>
                        <Select value={sampleRate.toString()} onValueChange={v => setSampleRate(parseInt(v))}>
                          <SelectTrigger id="frequence" className="h-8 w-full text-xs">
                            <SelectValue className="tabular-nums" />
                          </SelectTrigger>
                          <SelectContent className="tabular-nums">
                            <SelectItem value="8000">8 kHz — Téléphone</SelectItem>
                            <SelectItem value="12000">12 kHz — Voix</SelectItem>
                            <SelectItem value="16000">16 kHz — Podcast</SelectItem>
                            <SelectItem value="22050">22 kHz — Radio</SelectItem>
                            <SelectItem value="44100">44.1 kHz — CD</SelectItem>
                            <SelectItem value="48000">48 kHz — Studio</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="min-w-0 space-y-2">
                        <label htmlFor="canaux" className="text-xs font-medium text-muted-foreground">Canaux</label>
                        <Select value={channels.toString()} onValueChange={v => setChannels(parseInt(v) as 1 | 2)}>
                          <SelectTrigger id="canaux" className="h-8 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">Mono</SelectItem>
                            <SelectItem value="2">Stéréo</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="bg-graphite px-4 py-3 font-mono text-graphite-foreground">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-xs uppercase tracking-[0.06em] text-graphite-muted">Exécuté dans votre navigateur</p>
                <p className="text-xs text-graphite-muted tabular-nums">
                  OGG Vorbis · {bitrate} kb/s · {formatRate(sampleRate)} · {channels === 1 ? "mono" : "stéréo"}
                </p>
              </div>
              <code className="mt-2 flex flex-wrap gap-x-[1ch] text-xs leading-relaxed">
                <span className="text-graphite-signal">ffmpeg</span>
                {[
                  ["-i", "entrée"],
                  ["-vn", null],
                  ["-map", "0:a"],
                  ["-c:a", "libvorbis"],
                  ["-ac", channels],
                  ["-ar", sampleRate],
                  ["-b:a", `${bitrate}k`],
                  ["-compression_level", 10],
                ].map(([flag, value]) => (
                  <span key={flag} className="whitespace-nowrap">
                    <span className="text-graphite-muted">{flag}</span>
                    {value !== null && <> {value}</>}
                  </span>
                ))}
                <span>sortie.ogg</span>
              </code>
            </div>
          </section>

          {/* 4 · Run */}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
              {!hasFiles
                ? "Ajoutez au moins un fichier pour commencer."
                : pendingCount > 0
                  ? `${pendingCount} fichier${pendingCount > 1 ? "s" : ""} en attente`
                  : "Tous les fichiers sont compressés."}
            </p>
            <Button
              onClick={handleCompressAll}
              disabled={pendingCount === 0 || isCompressing || !ffmpegLoaded}
              size="lg"
              className="h-11 w-full bg-signal px-6 font-semibold text-signal-foreground hover:bg-signal/90 focus-visible:ring-ring/40 sm:w-auto sm:min-w-52"
            >
              {isCompressing ? (
                <><Loader2 className="size-4 animate-spin" />Compression en cours…</>
              ) : !ffmpegLoaded ? (
                <><Loader2 className="size-4 animate-spin" />Chargement FFmpeg…</>
              ) : (
                <>Compresser{pendingCount > 0 ? ` ${pendingCount} fichier${pendingCount > 1 ? "s" : ""}` : ""}</>
              )}
            </Button>
          </div>

          <AnimatePresence>
            {globalError && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertDescription>{globalError}</AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Ft2 · single line */}
      <footer className="border-t border-border">
        <p className="mx-auto max-w-3xl px-4 py-4 text-xs text-muted-foreground sm:px-6">
          Audio Compressor · Traitement 100{" "}% local, aucun envoi sur un serveur · OGG Vorbis via FFmpeg.wasm
        </p>
      </footer>
    </div>
    </MotionConfig>
  )
}
