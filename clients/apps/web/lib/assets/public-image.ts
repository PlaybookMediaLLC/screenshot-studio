import images from './public-images.json'

/** Immutable R2 image URL; same-origin delivery keeps canvas exports untainted. */
export function publicImageUrl(src: string): string {
  if (!process.env.NEXT_PUBLIC_R2_PUBLIC_URL) return src
  const index = src.search(/[?#]/)
  const path = index < 0 ? src : src.slice(0, index)
  const suffix = index < 0 ? '' : src.slice(index)
  const key = images[path as keyof typeof images]
  return key ? `/r2-assets/${key.split('/').map(encodeURIComponent).join('/')}${suffix}` : src
}
