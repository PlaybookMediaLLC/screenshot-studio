/** Remembers whether the platform sidebar is collapsed, read on the server to avoid a flash. */
export const PLATFORM_SIDEBAR_COOKIE = 'platform_sidebar'

/**
 * Three dark surfaces, each one step lighter (after Polar's dashboard):
 * the page and sidebar, the inset content panel, and its hairline border.
 */
export const surface = {
  base: 'bg-[#090909]',
  border: 'border-[#1c1c1c]',
  panel: 'bg-[#111111]',
} as const
