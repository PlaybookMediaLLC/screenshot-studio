import {
  type CodeContent,
  type CodeLanguage,
  type CodeTheme,
  codeContentSchema,
  type Tone,
} from './schema'

/**
 * Code screens are laid out in em of the code's font size, so their shape is
 * known before anything renders: the editor, previews, and exports all size
 * the screen from the text, then scale the font to the box.
 */

/** Advance width of a monospaced glyph, in em (JetBrains Mono, Fira Code, IBM Plex Mono, …). */
export const CODE_CHAR_WIDTH_EM = 0.6
/** Line height of code, in em. */
export const CODE_LINE_HEIGHT = 1.6
/** Narrowest a code screen gets, in columns, so a one-liner is not a sliver. */
const MIN_COLUMNS = 28
/** Widest a code screen gets, in columns; longer lines are clipped. */
const MAX_COLUMNS = 160
/** Most lines a code screen shows. */
const MAX_LINES = 400
/** Space between the line numbers and the code, in columns. */
const GUTTER_GAP_COLUMNS = 2

/** Code as it is laid out: Unix newlines, tabs as two spaces, no trailing blank lines. */
export function normalizeCode(code: string): string {
  return code.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/\s+$/, '')
}

/** The lines a code screen shows, at most {@link MAX_LINES}. */
export function codeLines(code: string): string[] {
  return normalizeCode(code).split('\n').slice(0, MAX_LINES)
}

/** A code screen's size in em, and the parts that make it up. */
export type CodeMetrics = {
  columns: number
  /** Width of the line-number gutter, including its gap, in em. */
  gutterEm: number
  heightEm: number
  lines: number
  widthEm: number
}

/** The em size of a code screen's text block with its padding. */
export function codeMetrics(
  content: Pick<CodeContent, 'code' | 'lineNumbers' | 'padding'>
): CodeMetrics {
  const lines = codeLines(content.code)
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const columns = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, longest + 1))
  const gutterEm = content.lineNumbers
    ? (String(lines.length).length + GUTTER_GAP_COLUMNS) * CODE_CHAR_WIDTH_EM
    : 0
  return {
    columns,
    gutterEm,
    heightEm: lines.length * CODE_LINE_HEIGHT + content.padding * 2,
    lines: lines.length,
    widthEm: columns * CODE_CHAR_WIDTH_EM + gutterEm + content.padding * 2,
  }
}

/** A code screen's width / height. */
export function codeAspect(content: Pick<CodeContent, 'code' | 'lineNumbers' | 'padding'>): number {
  const metrics = codeMetrics(content)
  return metrics.widthEm / metrics.heightEm
}

/** A code theme's name, background, and tone (for `auto` window chrome). */
export type CodeThemeInfo = { background: string; label: string; tone: Tone }

/** Every code theme. Backgrounds are fixed here so every renderer paints the same color. */
export const CODE_THEMES: Record<CodeTheme, CodeThemeInfo> = {
  dracula: { background: '#282a36', label: 'Dracula', tone: 'dark' },
  'duotone-dark': { background: '#2a2734', label: 'Duotone', tone: 'dark' },
  github: { background: '#ffffff', label: 'GitHub', tone: 'light' },
  'gruvbox-dark': { background: '#1d2021', label: 'Gruvbox', tone: 'dark' },
  'material-light': { background: '#fafafa', label: 'Material Light', tone: 'light' },
  'night-owl': { background: '#011627', label: 'Night Owl', tone: 'dark' },
  nord: { background: '#2e3440', label: 'Nord', tone: 'dark' },
  'one-dark': { background: '#282c34', label: 'One Dark', tone: 'dark' },
  'one-light': { background: '#fafafa', label: 'One Light', tone: 'light' },
  synthwave84: { background: '#262335', label: "Synthwave '84", tone: 'dark' },
  vs: { background: '#ffffff', label: 'Visual Studio', tone: 'light' },
  'vsc-dark-plus': { background: '#1e1e1e', label: 'VS Code Dark+', tone: 'dark' },
}

/** Language names for the language picker. */
export const CODE_LANGUAGES: Record<CodeLanguage, string> = {
  bash: 'Bash',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  diff: 'Diff',
  docker: 'Dockerfile',
  go: 'Go',
  graphql: 'GraphQL',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  kotlin: 'Kotlin',
  markdown: 'Markdown',
  markup: 'HTML / XML',
  php: 'PHP',
  powershell: 'PowerShell',
  python: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  'shell-session': 'Terminal session',
  sql: 'SQL',
  swift: 'Swift',
  text: 'Plain text',
  toml: 'TOML',
  tsx: 'TSX',
  typescript: 'TypeScript',
  yaml: 'YAML',
}

/** The code a new code screen starts with. */
export const SAMPLE_CODE = `import { createStudio } from '@playbook/studio'

const studio = createStudio({ workspace: 'launch' })

export async function shipIt(release: string) {
  const shot = await studio.capture('https://shots.playbookmedia.io')
  return studio.publish(shot, { release, channels: ['x', 'linkedin'] })
}
`

/** A new code screen's content. */
export function createCodeContent(code: string = SAMPLE_CODE): CodeContent {
  return codeContentSchema.parse({ code })
}
