import { Inter } from 'next/font/google'

/**
 * Polar's typeface stack is PP Neue Montreal over Inter and Inter Display.
 * PP Neue Montreal is licensed, so the shell uses Polar's own fallback:
 * variable Inter, whose optical-size axis gives Inter Display at large sizes.
 */
export const platformFont = Inter({
  axes: ['opsz'],
  display: 'swap',
  preload: false,
  subsets: ['latin'],
})
