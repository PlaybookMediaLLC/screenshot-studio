import { z } from 'zod'

/**
 * What an AI background request carries, and the rules every generated
 * background follows. Shared by the generator and its tests.
 */

/** Canvas shapes the generator draws for. */
export const backgroundAspectSchema = z.enum([
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '4:5',
  '5:4',
  '21:9',
])
/** A background aspect ratio. */
export type BackgroundAspect = z.infer<typeof backgroundAspectSchema>

/** What to generate. */
export const backgroundRequestSchema = z.object({
  aspect: backgroundAspectSchema,
  palette: z
    .array(z.string().regex(/^#[0-9a-f]{6}$/i))
    .max(8)
    .default([]),
  prompt: z.string().trim().min(3, 'Describe the background.').max(600),
})
/** A background request. */
export type BackgroundRequest = z.infer<typeof backgroundRequestSchema>

/** Long side of a stored background, in px. */
const LONG_SIDE = 2400

/** Pixel size of a stored background for an aspect ratio. */
export function backgroundSize(aspect: BackgroundAspect): { height: number; width: number } {
  const [w, h] = aspect.split(':').map(Number) as [number, number]
  return w >= h
    ? { height: Math.round((LONG_SIDE * h) / w), width: LONG_SIDE }
    : { height: LONG_SIDE, width: Math.round((LONG_SIDE * w) / h) }
}

/** The instruction the image model gets: the user's words plus the rules every background follows. */
export function backgroundPrompt(request: BackgroundRequest): string {
  return [
    `Create a background image for a product screenshot composition, aspect ratio ${request.aspect}.`,
    `Description: ${request.prompt}`,
    request.palette.length ? `Use this colour palette: ${request.palette.join(', ')}.` : '',
    'Abstract or atmospheric only: no text, letters, logos, user interfaces, devices, or people.',
    'Keep the centre calm and low in detail so a screenshot placed there stays readable.',
  ]
    .filter(Boolean)
    .join('\n')
}
