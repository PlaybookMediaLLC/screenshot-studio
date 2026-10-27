import { render as renderEmail, toPlainText } from '@react-email/render'
import type { ReactElement } from 'react'

/**
 * Rendered email content.
 *
 * Both parts are always produced. A message with no plaintext alternative
 * scores worse with spam filters and is unreadable in terminal clients and
 * some screen readers, so the text part is not optional.
 */
export interface RenderedEmail {
  html: string
  text: string
}

/**
 * Render a React Email component to the HTML and plaintext parts of a
 * message.
 *
 * React Email inlines styles and emits table-based markup, which is what
 * mail clients require. Rendering both parts from a single component keeps
 * them from drifting, which is the usual failure when the text alternative
 * is maintained by hand.
 */
export async function renderTemplate(template: ReactElement): Promise<RenderedEmail> {
  const html = await renderEmail(template)
  const text = toPlainText(html)

  return { html, text }
}
