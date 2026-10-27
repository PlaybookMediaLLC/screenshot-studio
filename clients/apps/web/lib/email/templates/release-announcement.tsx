import { Button, Img, Section, Text } from '@react-email/components'
import { EmailLayout, emailStyles } from './layout'

export interface ReleaseAnnouncementEmailProps {
  benefitStatement: string
  bodyMarkdown: string
  ctaLabel?: string
  ctaUrl?: string
  /** Absolute URL. Mail clients cannot resolve relative image paths. */
  heroImageUrl?: string
  postalAddress?: string
  productName: string
  title: string
  unsubscribeUrl: string
}

/**
 * Release announcement sent to a customer audience.
 *
 * Commercial mail, so the unsubscribe link and postal address are
 * required rather than optional: CAN-SPAM requires both, and Gmail and
 * Yahoo require a working unsubscribe for bulk senders. The types make
 * `unsubscribeUrl` mandatory so a caller cannot omit it by accident.
 */
export function ReleaseAnnouncementEmail({
  benefitStatement,
  bodyMarkdown,
  ctaLabel,
  ctaUrl,
  heroImageUrl,
  postalAddress,
  productName,
  title,
  unsubscribeUrl,
}: ReleaseAnnouncementEmailProps) {
  const paragraphs = toParagraphs(bodyMarkdown)

  return (
    <EmailLayout
      postalAddress={postalAddress}
      preview={benefitStatement}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={emailStyles.subtle}>{productName}</Text>
      <Text style={emailStyles.heading}>{title}</Text>
      <Text style={emailStyles.paragraph}>{benefitStatement}</Text>

      {heroImageUrl ? (
        <Section style={{ margin: '20px 0' }}>
          <Img
            alt={title}
            src={heroImageUrl}
            style={{ borderRadius: '6px', maxWidth: '100%', width: '100%' }}
          />
        </Section>
      ) : null}

      {paragraphs.map((paragraph) => (
        <Text key={paragraph.slice(0, 48)} style={emailStyles.paragraph}>
          {paragraph}
        </Text>
      ))}

      {ctaUrl ? (
        <Section style={{ margin: '24px 0 0' }}>
          <Button href={ctaUrl} style={emailStyles.button}>
            {ctaLabel ?? 'See what changed'}
          </Button>
        </Section>
      ) : null}
    </EmailLayout>
  )
}

/**
 * Flatten release body Markdown into display paragraphs.
 *
 * Release bodies are authored as Markdown, but rendering arbitrary
 * Markdown to email HTML would mean shipping a converter and sanitizing
 * its output, since the body is tenant-supplied. Emitting text paragraphs
 * keeps tenant content inert: React escapes it, so a body containing
 * markup cannot inject HTML into the message.
 */
function toParagraphs(bodyMarkdown: string): string[] {
  return bodyMarkdown
    .split(/\n{2,}/)
    .map((block) =>
      block
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^[-*]\s+/gm, '• ')
        .replace(/\r?\n/g, ' ')
        .trim()
    )
    .filter(Boolean)
}

export default ReleaseAnnouncementEmail
