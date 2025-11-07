"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { FFmpeg } from "@ffmpeg/ffmpeg"
import { fetchFile } from "@ffmpeg/util"
import {
  CheckCircle2,
  Download,
  FileAudio,
  Info,
  Settings,
  Upload,
  Zap,
  X,
  Trash2
} from "lucide-react"
import React, { useEffect, useRef, useState } from "react"

const ffmpeg = new FFmpeg()

interface PresetConfig {
  bitrate: number
  sampleRate: number
  channels: 1 | 2
  label: string
}

type PresetKey = "ultra" | "light" | "medium" | "quality" | "custom"

const PRESETS: Record<PresetKey, PresetConfig> = {
  ultra: { bitrate: 16, sampleRate: 12000, channels: 1, label: "Ultra léger (Voix)" },
  light: { bitrate: 32, sampleRate: 16000, channels: 1, label: "Léger (Podcast)" },
  medium: { bitrate: 64, sampleRate: 22050, channels: 1, label: "Moyen (Mono)" },
  quality: { bitrate: 96, sampleRate: 44100, channels: 2, label: "Qualité (Stéréo)" },
  custom: { bitrate: 32, sampleRate: 16000, channels: 1, label: "Personnalisé" }
}

interface AudioFile {
  id: string
  file: File
  originalSize: number
  compressedSize: number | null
  compressedUrl: string | null
  progress: number
  status: 'pending' | 'compressing' | 'completed' | 'error'
  error: string | null
}

export default function AudioCompressor() {
  const [files, setFiles] = useState<AudioFile[]>([])
  const [isCompressing, setIsCompressing] = useState<boolean>(false)
  const [preset, setPreset] = useState<PresetKey>("light")
  const [bitrate, setBitrate] = useState<number>(32)
  const [sampleRate, setSampleRate] = useState<number>(16000)
  const [channels, setChannels] = useState<1 | 2>(1)
  const [ffmpegLoaded, setFfmpegLoaded] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadFFmpeg()
  }, [])

  const loadFFmpeg = async () => {
    try {
      if (!ffmpeg.loaded) {
        const cdnConfigs = [
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
          }
        ]
        
        let loaded = false
        let lastError = null
        
        for (const config of cdnConfigs) {
          try {
            console.log('Tentative de chargement depuis:', config.coreURL)
            await ffmpeg.load(config)
            loaded = true
            console.log('FFmpeg chargé avec succès!')
            break
          } catch (err) {
            lastError = err
            console.warn(`Échec du chargement depuis ${config.coreURL}:`, err)
          }
        }
        
        if (loaded) {
          setFfmpegLoaded(true)
        } else {
          throw lastError || new Error("Impossible de charger FFmpeg depuis aucun CDN")
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError("Erreur de chargement FFmpeg: " + message + ". Essayez de recharger la page.")
      console.error('Erreur FFmpeg complète:', err)
    }
  }

  const handlePresetChange = (value: string) => {
    const presetKey = value as PresetKey
    setPreset(presetKey)
    if (presetKey !== "custom") {
      setBitrate(PRESETS[presetKey].bitrate)
      setSampleRate(PRESETS[presetKey].sampleRate)
      setChannels(PRESETS[presetKey].channels)
    }
  }

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("audio/"))
    if (droppedFiles.length > 0) {
      addFiles(droppedFiles)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : []
    if (selectedFiles.length > 0) {
      addFiles(selectedFiles)
    }
  }

  const addFiles = (newFiles: File[]) => {
    const audioFiles: AudioFile[] = newFiles.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      originalSize: file.size,
      compressedSize: null,
      compressedUrl: null,
      progress: 0,
      status: 'pending' as const,
      error: null
    }))
    setFiles(prev => [...prev, ...audioFiles])
    setError(null)
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const clearAll = () => {
    setFiles([])
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const compressFile = async (audioFile: AudioFile) => {
    try {
      setFiles(prev => prev.map(f => 
        f.id === audioFile.id ? { ...f, status: 'compressing' as const, progress: 10 } : f
      ))

      const inputName = "input" + audioFile.file.name.substring(audioFile.file.name.lastIndexOf("."))
      const outputName = "output.ogg"

      await ffmpeg.writeFile(inputName, await fetchFile(audioFile.file))
      
      setFiles(prev => prev.map(f => 
        f.id === audioFile.id ? { ...f, progress: 30 } : f
      ))

      await ffmpeg.exec([
        "-i", inputName,
        "-ac", channels.toString(),
        "-ar", sampleRate.toString(),
        "-b:a", `${bitrate}k`,
        "-compression_level", "10",
        "-vn",
        outputName
      ])

      setFiles(prev => prev.map(f => 
        f.id === audioFile.id ? { ...f, progress: 80 } : f
      ))

      const data = await ffmpeg.readFile(outputName)
      const byteData = data instanceof Uint8Array ? data : new TextEncoder().encode(data)
      const view = (byteData.byteOffset === 0 && byteData.byteLength === byteData.buffer.byteLength)
        ? byteData
        : byteData.slice()
      const blob = new Blob([view.buffer as ArrayBuffer], { type: "audio/ogg" })
      const url = URL.createObjectURL(blob)

      setFiles(prev => prev.map(f => 
        f.id === audioFile.id ? { 
          ...f, 
          compressedUrl: url,
          compressedSize: blob.size,
          progress: 100,
          status: 'completed' as const
        } : f
      ))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFiles(prev => prev.map(f => 
        f.id === audioFile.id ? { 
          ...f, 
          status: 'error' as const,
          error: message,
          progress: 0
        } : f
      ))
    }
  }

  const handleCompressAll = async () => {
    if (files.length === 0) {
      setError("Veuillez ajouter au moins un fichier audio")
      return
    }

    if (!ffmpegLoaded) {
      setError("FFmpeg n'est pas encore chargé, veuillez patienter...")
      return
    }

    setIsCompressing(true)
    setError(null)

    const pendingFiles = files.filter(f => f.status === 'pending' || f.status === 'error')
    
    for (const file of pendingFiles) {
      await compressFile(file)
    }

    setIsCompressing(false)
  }

  const downloadAll = () => {
    files.filter(f => f.compressedUrl).forEach(file => {
      const a = document.createElement('a')
      a.href = file.compressedUrl!
      a.download = `${file.file.name.replace(/\.[^/.]+$/, "")}_compressed.ogg`
      a.click()
    })
  }

  const totalOriginalSize = files.reduce((sum, f) => sum + f.originalSize, 0)
  const totalCompressedSize = files.reduce((sum, f) => sum + (f.compressedSize || 0), 0)
  const completedCount = files.filter(f => f.status === 'completed').length

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 w-full via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-slate-900 dark:to-indigo-950 p-4 flex items-center justify-center">
      <Card className="w-full max-w-4xl shadow-2xl border-0 backdrop-blur-sm bg-white/80 dark:bg-gray-900/80">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-linear-to-br from-blue-500 to-indigo-600 rounded-lg">
                <FileAudio className="w-6 h-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold font-bricolage">Audio Compressor</CardTitle>
                <p className="text-sm text-muted-foreground">Compressez plusieurs fichiers audio en une fois</p>
              </div>
            </div>
            {files.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <Trash2 className="w-4 h-4 mr-2" />
                Tout effacer
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Zone de drop */}
          <div
            onDrop={handleFileDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="relative border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-all duration-200 group"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="space-y-3">
              <div className="mx-auto w-16 h-16 bg-linear-to-br from-blue-100 to-indigo-100 dark:from-blue-900 dark:to-indigo-900 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                <Upload className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-gray-700 dark:text-gray-300">
                  Glissez-déposez ou cliquez pour sélectionner
                </p>
                <p className="text-xs text-gray-500">Formats supportés : MP3, WAV, OGG, M4A, FLAC (plusieurs fichiers)</p>
              </div>
            </div>
          </div>

          {/* Liste des fichiers */}
          {files.length > 0 && (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {files.map(audioFile => (
                <div key={audioFile.id} className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <FileAudio className="w-4 h-4 text-blue-500 shrink-0" />
                        <p className="font-medium text-sm text-gray-900 dark:text-white truncate">
                          {audioFile.file.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-600 dark:text-gray-400">
                        <span>{formatBytes(audioFile.originalSize)}</span>
                        {audioFile.compressedSize && (
                          <>
                            <span>→</span>
                            <span className="text-green-600 dark:text-green-400 font-semibold">
                              {formatBytes(audioFile.compressedSize)}
                            </span>
                            <span className="text-blue-600 dark:text-blue-400">
                              (-{Math.round((1 - audioFile.compressedSize / audioFile.originalSize) * 100)}%)
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {audioFile.status === 'completed' && audioFile.compressedUrl && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          asChild
                        >
                          <a href={audioFile.compressedUrl} download={`${audioFile.file.name.replace(/\.[^/.]+$/, "")}_compressed.ogg`}>
                            <Download className="w-4 h-4" />
                          </a>
                        </Button>
                      )}
                      {audioFile.status === 'completed' && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                      {audioFile.status === 'pending' && (
                        <Button size="sm" variant="ghost" onClick={() => removeFile(audioFile.id)}>
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {audioFile.status === 'compressing' && (
                    <div className="space-y-1">
                      <Progress value={audioFile.progress} className="h-1.5" />
                      <p className="text-xs text-center text-gray-500">{audioFile.progress}%</p>
                    </div>
                  )}
                  
                  {audioFile.status === 'error' && (
                    <Alert variant="destructive" className="py-2 ">
                      <AlertDescription className="text-xs">{audioFile.error}</AlertDescription>
                    </Alert>
                  )}

                  {audioFile.status === 'completed' && audioFile.compressedUrl && (
                    <audio controls src={audioFile.compressedUrl} className="w-full h-8" />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Statistiques globales */}
          {completedCount > 0 && (
            <div className="grid grid-cols-3 gap-3 p-4 bg-linear-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 rounded-lg border border-green-200 dark:border-green-800">
              <div className="text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total avant</p>
                <p className="font-bold text-gray-900 dark:text-white">{formatBytes(totalOriginalSize)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total après</p>
                <p className="font-bold text-green-600 dark:text-green-400">{formatBytes(totalCompressedSize)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Économie</p>
                <p className="font-bold text-blue-600 dark:text-blue-400">
                  {totalCompressedSize > 0 ? Math.round((1 - totalCompressedSize / totalOriginalSize) * 100) : 0}%
                </p>
              </div>
            </div>
          )}

          {/* Options de compression */}
          <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Settings className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <h3 className="font-semibold text-gray-900 dark:text-white">Paramètres de compression</h3>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Preset de qualité
              </label>
              <Select value={preset} onValueChange={handlePresetChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent >
                  {Object.entries(PRESETS).map(([key, value]) => (
                    <SelectItem className="font-sans" key={key} value={key}>
                      {value.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {preset === "custom" && (
              <div className="space-y-4 pt-2 border-t border-gray-200 dark:border-gray-700">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Bitrate audio
                    </label>
                    <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                      {bitrate} kb/s
                    </span>
                  </div>
                  <Slider
                    value={[bitrate]}
                    onValueChange={(v) => setBitrate(v[0])}
                    min={16}
                    max={192}
                    step={8}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>16 kb/s</span>
                    <span>192 kb/s</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Fréquence d&apos;échantillonnage
                  </label>
                  <Select value={sampleRate.toString()} onValueChange={(v: string) => setSampleRate(parseInt(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="8000">8 kHz (Téléphone)</SelectItem>
                      <SelectItem value="12000">12 kHz (Voix basse)</SelectItem>
                      <SelectItem value="16000">16 kHz (Podcast)</SelectItem>
                      <SelectItem value="22050">22.05 kHz (Radio)</SelectItem>
                      <SelectItem value="44100">44.1 kHz (CD)</SelectItem>
                      <SelectItem value="48000">48 kHz (Studio)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Canaux audio
                  </label>
                  <Select value={channels.toString()} onValueChange={(v: string) => setChannels(parseInt(v) as 1 | 2)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Mono (1 canal)</SelectItem>
                      <SelectItem value="2">Stéréo (2 canaux)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {preset !== "custom" && (
              <div className="bg-blue-50 flex gap-4 items-center px-3 py-4 rounded-xl border dark:bg-blue-500/30 border-blue-200 dark:border-blue-800">
                <Info  className="h-4 w-4 text-blue-600 " />
                <p className="text-sm font-mono text-blue-600 dark:text-blue-300">
                  {bitrate} kb/s · {sampleRate / 1000} kHz · {channels === 1 ? "Mono" : "Stéréo"}
                </p>
              </div>
            )}
          </div>

          {/* Boutons d'action */}
          <div className="flex gap-3">
            <Button
              onClick={handleCompressAll}
              disabled={files.length === 0 || isCompressing || !ffmpegLoaded}
              className="flex-1 h-12 text-base font-semibold bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
              size="lg"
            >
              {isCompressing ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
                  Compression en cours...
                </>
              ) : !ffmpegLoaded ? (
                <>Chargement de FFmpeg...</>
              ) : (
                <>
                  <Zap className="w-5 h-5 mr-2" />
                  Compresser tout ({files.filter(f => f.status === 'pending' || f.status === 'error').length})
                </>
              )}
            </Button>

            {completedCount > 0 && (
              <Button
                onClick={downloadAll}
                className="h-12 bg-green-600 hover:bg-green-700"
                size="lg"
              >
                <Download className="w-5 h-5 mr-2" />
                Télécharger tout ({completedCount})
              </Button>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}