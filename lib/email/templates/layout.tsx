import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { ReactNode } from 'react'

/**
 * Shared shell for every outbound message.
 *
 * Styles are inline objects rather than classes because mail clients
 * strip stylesheets, and Gmail in particular removes `<style>` blocks
 * entirely. Colors are literal for the same reason: CSS custom properties
 * do not resolve in most clients.
 */

const colors = {
  background: '#f6f6f7',
  border: '#e4e4e7',
  muted: '#71717a',
  surface: '#ffffff',
  text: '#18181b',
}

const styles = {
  body: {
    backgroundColor: colors.background,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    margin: 0,
    padding: '32px 0',
  },
  container: {
    backgroundColor: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    margin: '0 auto',
    maxWidth: '560px',
    padding: '32px',
  },
  footer: {
    color: colors.muted,
    fontSize: '12px',
    lineHeight: '18px',
    margin: '0 0 8px',
  },
  footerLink: { color: colors.muted, textDecoration: 'underline' },
  hr: { borderColor: colors.border, margin: '28px 0 20px' },
  wordmark: {
    color: colors.text,
    fontSize: '15px',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    margin: '0 0 24px',
  },
}

export interface EmailLayoutProps {
  children: ReactNode
  /** Inbox preview line. Without it clients show the first body text. */
  preview: string
  /**
   * One-click unsubscribe target. Present only on commercial mail;
   * transactional messages must not offer to opt out of themselves.
   */
  unsubscribeUrl?: string
  /** Required by CAN-SPAM on commercial mail. */
  postalAddress?: string
}

export function EmailLayout({
  children,
  postalAddress,
  preview,
  unsubscribeUrl,
}: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.wordmark}>Screenshot Studio</Text>
          {children}
          <Hr style={styles.hr} />
          <Section>
            {postalAddress ? <Text style={styles.footer}>{postalAddress}</Text> : null}
            {unsubscribeUrl ? (
              <Text style={styles.footer}>
                <Link href={unsubscribeUrl} style={styles.footerLink}>
                  Unsubscribe from product announcements
                </Link>
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const emailStyles = {
  button: {
    backgroundColor: colors.text,
    borderRadius: '6px',
    color: colors.surface,
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: 600,
    padding: '11px 20px',
    textDecoration: 'none',
  },
  heading: {
    color: colors.text,
    fontSize: '22px',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    lineHeight: '30px',
    margin: '0 0 14px',
  },
  link: { color: colors.text, textDecoration: 'underline' },
  paragraph: {
    color: colors.text,
    fontSize: '15px',
    lineHeight: '24px',
    margin: '0 0 16px',
  },
  subtle: {
    color: colors.muted,
    fontSize: '13px',
    lineHeight: '20px',
    margin: '16px 0 0',
  },
}
