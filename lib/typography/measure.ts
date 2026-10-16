'use client'

import { useEffect, useState } from 'react'

let context: CanvasRenderingContext2D | null = null

/** A line's width in px for a CSS font, measured with the browser's text metrics. */
export function measureLine(line: string, font: { family: string; letterSpacing?: number; size: number; weight: string }): number {
  context ??= document.createElement('canvas').getContext('2d')
  if (!context) return line.length * font.size * 0.55
  const weight = font.weight === 'bold' ? '700' : font.weight === 'normal' ? '400' : font.weight.replace(/\D/g, '') || '400'
  context.font = `${weight} ${font.size}px ${font.family}`
  return context.measureText(line).width + Math.max(0, line.length - 1) * (font.letterSpacing ?? 0) * font.size
}

/** Changes whenever the document finishes loading fonts, so measurements refresh. */
export function useFontsVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((value) => value + 1)
    document.fonts.addEventListener('loadingdone', bump)
    return () => document.fonts.removeEventListener('loadingdone', bump)
  }, [])
  return version
}
