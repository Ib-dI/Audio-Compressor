# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun dev      # Start Next.js dev server
bun run build    # Production build
bun run start    # Start production server
bun run lint     # Run ESLint
```

## Architecture

**Next.js 16 App Router** with React 19, TypeScript 5, Tailwind CSS 4, Framer Motion.

Audio processing runs **entirely client-side** via FFmpeg.js (WebAssembly) — no server upload needed. FFmpeg is loaded from CDN at runtime with 3 fallback URLs.

### Key Files

- [components/AudioCompressor.tsx](components/AudioCompressor.tsx) — Core component: file upload, FFmpeg orchestration, compression pipeline, download
- [hooks/use-file-upload.ts](hooks/use-file-upload.ts) — Drag-drop file upload state management
- [app/page.tsx](app/page.tsx) — Home page (thin wrapper)
- [app/layout.tsx](app/layout.tsx) — Root layout, fonts (Bricolage Grotesque, Geist), lang="fr"
- [lib/utils.ts](lib/utils.ts) — `cn()` utility for Tailwind class merging
- [components/ui/](components/ui/) — shadcn/ui components (Radix UI-based)

### Compression Pipeline

1. Files validated and queued as `AudioFile[]` (tracks id, progress, status, error)
2. FFmpeg instance loaded from CDN (tried sequentially: unpkg → jsDelivr → fallback)
3. Files compressed sequentially; progress reported at 10% → 30% → 80% → 100%
4. Output format: OGG with configurable codec params
5. Files available for individual or batch ZIP download

### Presets

5 built-in presets (all labels in French):
- **Ultra Léger (Voice):** 16kb/s, 12kHz, mono
- **Léger (Podcast):** 32kb/s, 16kHz, mono
- **Moyen (Mono):** 64kb/s, 22.05kHz, mono
- **Qualité (Stereo):** 96kb/s, 44.1kHz, stereo
- **Custom:** user-configurable

### UI Stack

Radix UI primitives → shadcn/ui components → Tailwind CSS 4 styling. All UI text is in **French**. Dark mode supported via `dark:` prefixes.

### FFmpeg Reference

See [.cursor/rules/reference.md](.cursor/rules/reference.md) for FFmpeg filter syntax, codec options, and common patterns. Key rules:
- Use `-movflags faststart -pix_fmt yuv420p` for web playback
- Chain filters with commas; use `filter_complex` with labels for complex graphs
- Use `-c copy` for fast processing when no re-encoding needed
- Normalize audio with the `loudnorm` filter

### Path Aliases

`@/*` maps to the project root (configured in [tsconfig.json](tsconfig.json)).
