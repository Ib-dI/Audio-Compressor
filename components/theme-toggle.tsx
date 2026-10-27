"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { useSyncExternalStore } from "react"
import { motion, AnimatePresence } from "framer-motion"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  // next-themes re-enables transitions 1 ms after the switch, before Safari has
  // repainted, so boxes still animate their colours. Hold transitions off until
  // the new theme class is on <html> and two frames have actually been painted.
  const toggleTheme = () => {
    const root = document.documentElement
    root.classList.add("theme-switching")
    let released = false
    const release = () => {
      if (released) return
      released = true
      observer.disconnect()
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")))
    }
    const observer = new MutationObserver(release)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    setTimeout(release, 500)
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }

  if (!mounted) return <div className="h-9 w-9" />

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      className="relative overflow-hidden bg-transparent text-muted-foreground shadow-none hover:text-foreground dark:bg-transparent"
      aria-label="Changer le thème"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={resolvedTheme}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {resolvedTheme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </motion.div>
      </AnimatePresence>
    </Button>
  )
}
