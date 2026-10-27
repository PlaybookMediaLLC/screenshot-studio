import { z } from 'zod'
import { GOOGLE_FONTS, googleFontId, isGoogleFontId } from '@/lib/typography/google-fonts'

/**
 * Framed screens: what holds a screenshot (or rendered code) on the canvas.
 *
 * Every screen in a composition, and the main screenshot, sits in one frame:
 * nothing, a browser, an application or terminal window, or a device. Browser
 * and window frames share one set of chrome options, so switching between
 * them keeps the address, tabs, and appearance the user typed.
 */

/** What a screen sits in. */
export const frameKindSchema = z.enum(['none', 'browser', 'window', 'device'])
/** A frame kind. */
export type FrameKind = z.infer<typeof frameKindSchema>

/** Browsers whose chrome the editor draws. */
export const browserSchema = z.enum(['safari', 'chrome', 'arc', 'edge', 'firefox'])
/** A browser. */
export type Browser = z.infer<typeof browserSchema>

/** Application and terminal window styles. */
export const windowStyleSchema = z.enum([
  'macos',
  'windows',
  'terminal-macos',
  'terminal-windows',
  'terminal-minimal',
])
/** A window style. */
export type WindowStyle = z.infer<typeof windowStyleSchema>

/** Light or dark chrome. */
export const toneSchema = z.enum(['light', 'dark'])
/** A tone. */
export type Tone = z.infer<typeof toneSchema>

/** Chrome appearance: fixed, or `auto` to follow the screenshot under it. */
export const appearanceSchema = z.enum(['auto', 'light', 'dark'])
/** A chrome appearance setting. */
export type Appearance = z.infer<typeof appearanceSchema>

/** How a device is held. */
export const deviceOrientationSchema = z.enum(['portrait', 'landscape'])
/** A device orientation. */
export type DeviceOrientation = z.infer<typeof deviceOrientationSchema>

/** Most tabs a browser frame shows. */
export const MAX_FRAME_TABS = 6
/** Most bookmarks a bookmarks bar shows. */
export const MAX_FRAME_BOOKMARKS = 8

/** Browser and window chrome options, shared by every browser and window style. */
export const frameChromeSchema = z.object({
  /** Index of the active tab in `tabs`. */
  activeTab: z
    .number()
    .int()
    .min(0)
    .max(MAX_FRAME_TABS - 1)
    .default(0),
  /** Address bar text. */
  address: z.string().max(200).default(''),
  appearance: appearanceSchema.default('auto'),
  /** Bookmarks bar entries, shown when `showBookmarks` is on. */
  bookmarks: z.array(z.string().max(40)).max(MAX_FRAME_BOOKMARKS).default([]),
  browser: browserSchema.default('chrome'),
  showBookmarks: z.boolean().default(false),
  /** Tab titles. An empty list shows one tab named after the address. */
  tabs: z.array(z.string().max(60)).max(MAX_FRAME_TABS).default([]),
  /** Window title, for application and terminal windows. */
  title: z.string().max(120).default(''),
  /**
   * The tone of the content's top edge, sampled when the content changes.
   * `auto` appearance draws this, so previews and exports never sample again.
   */
  tone: toneSchema.optional(),
  window: windowStyleSchema.default('macos'),
})
/** Browser and window chrome options. */
export type FrameChrome = z.infer<typeof frameChromeSchema>

/** Default chrome: Chrome in auto appearance with the editor's own address. */
export const DEFAULT_FRAME_CHROME: FrameChrome = frameChromeSchema.parse({
  address: 'shots.playbookmedia.io',
})

/** A screen's frame in a composition. Absent on older documents, which are devices. */
export const screenFrameSchema = z.object({
  /** Kept for browser and window frames, and between kind switches. */
  chrome: frameChromeSchema.optional(),
  kind: frameKindSchema,
})
/** A screen's frame. */
export type ScreenFrame = z.infer<typeof screenFrameSchema>

// ── Code screens ─────────────────────────────────────────────────────────────

/** Languages code screens highlight (Prism grammars shipped with react-syntax-highlighter). */
export const codeLanguageSchema = z.enum([
  'tsx',
  'typescript',
  'javascript',
  'jsx',
  'python',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'bash',
  'shell-session',
  'powershell',
  'json',
  'yaml',
  'toml',
  'css',
  'markup',
  'sql',
  'markdown',
  'diff',
  'docker',
  'graphql',
  'text',
])
/** A code language. */
export type CodeLanguage = z.infer<typeof codeLanguageSchema>

/** Syntax themes for code screens (Prism themes shipped with react-syntax-highlighter). */
export const codeThemeSchema = z.enum([
  'one-dark',
  'one-light',
  'vsc-dark-plus',
  'vs',
  'dracula',
  'nord',
  'night-owl',
  'github',
  'gruvbox-dark',
  'synthwave84',
  'material-light',
  'duotone-dark',
])
/** A code theme. */
export type CodeTheme = z.infer<typeof codeThemeSchema>

/** Monospaced Google Fonts families a code screen can use. */
export const CODE_FONT_IDS = GOOGLE_FONTS.filter((font) => font.category === 'monospace').map(
  (font) => googleFontId(font.family)!
)

/** Most characters of code one screen holds. */
export const MAX_CODE_LENGTH = 20_000

/**
 * Code rendered as a screen. The code and its options are stored, never a
 * bitmap, so the screen stays editable and renders the same everywhere.
 */
export const codeContentSchema = z.object({
  code: z.string().max(MAX_CODE_LENGTH),
  /** A monospaced Google Fonts family, as `google:<Family>`. */
  font: z
    .string()
    .max(80)
    .refine(
      (id) => isGoogleFontId(id) && CODE_FONT_IDS.includes(id),
      'Use a monospaced Google font.'
    )
    .default('google:JetBrains Mono'),
  language: codeLanguageSchema.default('tsx'),
  lineNumbers: z.boolean().default(true),
  /** Space around the code, in em of the code's font size. */
  padding: z.number().min(0).max(6).default(1.5),
  theme: codeThemeSchema.default('one-dark'),
})
/** A code screen's content. */
export type CodeContent = z.infer<typeof codeContentSchema>
