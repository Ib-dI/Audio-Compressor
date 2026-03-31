"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { motion, AnimatePresence } from "framer-motion"
import {
  CheckCircle2,
  Download,
  FileAudio,
  Upload,
  Zap,
  X,
  Trash2,
  AlertCircle,
  Loader2,
  Music2,
  SlidersHorizontal,
  Info,
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
  ultra:   { bitrate: 16, sampleRate: 12000, channels: 1, label: "Ultra léger", description: "Voix · 16 kb/s · 12 kHz · Mono" },
  light:   { bitrate: 32, sampleRate: 16000, channels: 1, label: "Léger",       description: "Podcast · 32 kb/s · 16 kHz · Mono" },
  medium:  { bitrate: 64, sampleRate: 22050, channels: 1, label: "Moyen",       description: "Radio · 64 kb/s · 22 kHz · Mono" },
  quality: { bitrate: 96, sampleRate: 44100, channels: 2, label: "Qualité",     description: "Stéréo · 96 kb/s · 44 kHz · Stéréo" },
  custom:  { bitrate: 32, sampleRate: 16000, channels: 1, label: "Personnalisé", description: "Configurer manuellement" },
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

const STATUS_STYLES: Record<AudioFile["status"], string> = {
  pending:    "border-l-border",
  compressing:"border-l-blue-500",
  completed:  "border-l-emerald-500",
  error:      "border-l-destructive",
}

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

  useEffect(() => {
    loadFFmpeg()
    return () => {
      setFiles(prev => {
        prev.forEach(f => { if (f.compressedUrl) URL.revokeObjectURL(f.compressedUrl) })
        return prev
      })
    }
  }, [])

  const loadFFmpeg = async () => {
    try {
      if (!ffmpegRef.current) ffmpegRef.current = new FFmpeg()
      const ffmpeg = ffmpegRef.current
      if (ffmpeg.loaded) { setFfmpegLoaded(true); return }

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
        a.download = `${file.file.name.replace(/\.[^/.]+$/, "")}_compressed.ogg`
        a.click()
      }, i * 200)
    })
  }

  const totalOriginal = files.reduce((s, f) => s + f.originalSize, 0)
  const totalCompressed = files.reduce((s, f) => s + (f.compressedSize ?? 0), 0)
  const completedCount = files.filter(f => f.status === "completed").length
  const pendingCount = files.filter(f => f.status === "pending" || f.status === "error").length
  const savings = totalCompressed > 0 ? Math.round((1 - totalCompressed / totalOriginal) * 100) : 0

  return (
    <div className="min-h-screen bg-linear-to-br from-background via-muted/30 to-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-indigo-600 shadow-sm">
              <Music2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-bricolage text-base font-semibold tracking-tight">Audio Compressor</span>
          </div>
          <div className="flex items-center gap-2">
            {!ffmpegLoaded && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Chargement FFmpeg…
              </span>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-4">
        {/* Drop zone */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-200
            ${isDragging
              ? "border-blue-500 bg-blue-500/5 scale-[1.01]"
              : "border-border hover:border-blue-400 hover:bg-muted/40"
            }`}
        >
          <input ref={fileInputRef} type="file" accept="audio/*" multiple onChange={handleFileSelect} className="hidden" />
          <div className="flex flex-col items-center gap-3">
            <motion.div
              animate={isDragging ? { scale: 1.15, rotate: -4 } : { scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 300 }}
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-blue-100 to-indigo-100 dark:from-blue-900/40 dark:to-indigo-900/40"
            >
              <Upload className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            </motion.div>
            <div>
              <p className="font-medium text-foreground">
                {isDragging ? "Déposez ici" : "Glissez-déposez ou cliquez pour sélectionner"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">MP3, WAV, OGG, M4A, FLAC — plusieurs fichiers acceptés</p>
            </div>
          </div>
        </motion.div>

        {/* File list */}
        <AnimatePresence initial={false}>
          {files.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-2 overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  {files.length} fichier{files.length > 1 ? "s" : ""}
                </span>
                <Button variant="ghost" size="sm" onClick={clearAll} className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                  <Trash2 className="mr-1.5 h-3 w-3" />
                  Tout effacer
                </Button>
              </div>

              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                  {files.map(audioFile => (
                    <motion.div
                      key={audioFile.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`rounded-xl border-l-4 bg-card p-3.5 shadow-sm ring-1 ring-border/50 ${STATUS_STYLES[audioFile.status]}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        {/* Icon + name */}
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg
                            ${audioFile.status === "completed" ? "bg-emerald-100 dark:bg-emerald-900/40" :
                              audioFile.status === "error"     ? "bg-red-100 dark:bg-red-900/40" :
                              audioFile.status === "compressing" ? "bg-blue-100 dark:bg-blue-900/40" :
                              "bg-muted"}`}
                          >
                            {audioFile.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                            {audioFile.status === "error"     && <AlertCircle  className="h-4 w-4 text-destructive" />}
                            {audioFile.status === "compressing" && <Loader2    className="h-4 w-4 animate-spin text-blue-500" />}
                            {audioFile.status === "pending"   && <FileAudio    className="h-4 w-4 text-muted-foreground" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{audioFile.file.name}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{formatBytes(audioFile.originalSize)}</span>
                              {audioFile.compressedSize && (
                                <>
                                  <span className="opacity-40">→</span>
                                  <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatBytes(audioFile.compressedSize)}</span>
                                  <span className="rounded-full bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                                    -{Math.round((1 - audioFile.compressedSize / audioFile.originalSize) * 100)}%
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          {audioFile.status === "completed" && audioFile.compressedUrl && (
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-emerald-100 dark:hover:bg-emerald-900/40" asChild>
                              <a href={audioFile.compressedUrl} download={`${audioFile.file.name.replace(/\.[^/.]+$/, "")}-c.ogg`}>
                                <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                              </a>
                            </Button>
                          )}
                          {(audioFile.status === "pending" || audioFile.status === "error") && (
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => removeFile(audioFile.id)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Progress bar */}
                      {audioFile.status === "compressing" && (
                        <div className="mt-2.5 space-y-1">
                          <Progress value={audioFile.progress} className="h-1" />
                          <p className="text-right text-xs text-muted-foreground">{audioFile.progress}%</p>
                        </div>
                      )}

                      {/* Error */}
                      {audioFile.status === "error" && (
                        <p className="mt-2 text-xs text-destructive">{audioFile.error}</p>
                      )}

                      {/* Audio player */}
                      {audioFile.status === "completed" && audioFile.compressedUrl && (
                        <audio controls src={audioFile.compressedUrl} className="mt-2.5 h-8 w-full" />
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats */}
        <AnimatePresence>
          {completedCount > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
            >
              <Card className="border-emerald-200/60 bg-linear-to-br from-emerald-50/60 to-teal-50/40 dark:border-emerald-800/40 dark:from-emerald-950/30 dark:to-teal-950/20">
                <CardContent className="grid grid-cols-3 divide-x divide-border/50 py-4">
                  {[
                    { label: "Avant", value: formatBytes(totalOriginal), color: "text-foreground" },
                    { label: "Après",  value: formatBytes(totalCompressed), color: "text-emerald-600 dark:text-emerald-400" },
                    { label: "Économie", value: `${savings}%`, color: "text-blue-600 dark:text-blue-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex flex-col items-center gap-0.5 px-4">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className={`text-lg font-bold ${color}`}>{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings */}
        <Card className="border-border/60">
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              Paramètres de compression
            </div>

            {/* Preset selector */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {(Object.entries(PRESETS) as [PresetKey, PresetConfig][]).map(([key, p]) => (
                <button
                  key={key}
                  onClick={() => handlePresetChange(key)}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-all duration-150
                    ${preset === key
                      ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30"
                      : "border-border bg-muted/40 hover:border-border/80 hover:bg-muted"
                    }`}
                >
                  <p className={`text-xs font-semibold ${preset === key ? "text-blue-600 dark:text-blue-400" : "text-foreground"}`}>
                    {p.label}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground line-clamp-2">
                    {p.description}
                  </p>
                </button>
              ))}
            </div>

            {/* Custom controls */}
            <AnimatePresence>
              {preset === "custom" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="grid gap-4 border-t border-border/50 pt-4 sm:grid-cols-3">
                    {/* Bitrate */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">Bitrate</label>
                        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">{bitrate} kb/s</span>
                      </div>
                      <Slider value={[bitrate]} onValueChange={v => setBitrate(v[0])} min={16} max={192} step={8} className="w-full" />
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>16</span><span>192 kb/s</span>
                      </div>
                    </div>

                    {/* Sample rate */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Fréquence</label>
                      <Select value={sampleRate.toString()} onValueChange={v => setSampleRate(parseInt(v))}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="8000">8 kHz — Téléphone</SelectItem>
                          <SelectItem value="12000">12 kHz — Voix</SelectItem>
                          <SelectItem value="16000">16 kHz — Podcast</SelectItem>
                          <SelectItem value="22050">22 kHz — Radio</SelectItem>
                          <SelectItem value="44100">44.1 kHz — CD</SelectItem>
                          <SelectItem value="48000">48 kHz — Studio</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Channels */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Canaux</label>
                      <Select value={channels.toString()} onValueChange={v => setChannels(parseInt(v) as 1 | 2)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Mono (1 canal)</SelectItem>
                          <SelectItem value="2">Stéréo (2 canaux)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Info bar for non-custom presets */}
            {preset !== "custom" && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5">
                <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-xs font-mono text-muted-foreground">
                  {bitrate} kb/s · {sampleRate >= 1000 ? `${sampleRate / 1000} kHz` : `${sampleRate} Hz`} · {channels === 1 ? "Mono" : "Stéréo"} · OGG Vorbis
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action buttons */}
        <div className="flex gap-3">
          <Button
            onClick={handleCompressAll}
            disabled={files.length === 0 || isCompressing || !ffmpegLoaded}
            size="lg"
            className="flex-1 h-11 bg-linear-to-r from-blue-600 to-indigo-600 font-semibold text-white shadow-md hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
          >
            {isCompressing ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Compression en cours…</>
            ) : !ffmpegLoaded ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Chargement FFmpeg…</>
            ) : (
              <><Zap className="mr-2 h-4 w-4" />Compresser {pendingCount > 0 ? `(${pendingCount})` : "tout"}</>
            )}
          </Button>

          <AnimatePresence>
            {completedCount > 0 && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                <Button
                  onClick={downloadAll}
                  size="lg"
                  className="h-11 bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Tout télécharger ({completedCount})
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Global error */}
        <AnimatePresence>
          {globalError && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{globalError}</AlertDescription>
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-muted-foreground/60">
        Traitement 100% local — aucun fichier n&apos;est envoyé sur un serveur
      </footer>
    </div>
  )
}
