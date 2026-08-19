import { Button, Section, Text } from '@react-email/components'
import { EmailLayout, emailStyles } from './layout'

export interface AuthActionEmailProps {
  actionUrl: string
  /** Distinguishes verification from password reset copy. */
  kind: 'verify-email' | 'reset-password'
}

const copy = {
  'reset-password': {
    body: 'Use the link below to choose a new password. It expires shortly, and your current password stays active until you complete the reset.',
    button: 'Reset password',
    heading: 'Reset your password',
    ignore: 'If you did not request this, ignore this email and your password will not change.',
    preview: 'Reset your Screenshot Studio password',
  },
  'verify-email': {
    body: 'Confirm this address to finish setting up your Screenshot Studio account.',
    button: 'Verify email',
    heading: 'Verify your email',
    ignore: 'If you did not create an account, you can safely ignore this email.',
    preview: 'Verify your Screenshot Studio email',
  },
} as const

/**
 * Verification and password reset.
 *
 * Transactional, so no unsubscribe link: a recipient who opted out of
 * announcements still needs to be able to reset their password. Both
 * variants share one component because the structure is identical and
 * duplicating it invites the two from drifting apart.
 */
export function AuthActionEmail({ actionUrl, kind }: AuthActionEmailProps) {
  const content = copy[kind]

  return (
    <EmailLayout preview={content.preview}>
      <Text style={emailStyles.heading}>{content.heading}</Text>
      <Text style={emailStyles.paragraph}>{content.body}</Text>
      <Section style={{ margin: '24px 0' }}>
        <Button href={actionUrl} style={emailStyles.button}>
          {content.button}
        </Button>
      </Section>
      <Text style={emailStyles.subtle}>
        If the button does not work, paste this link into your browser: {actionUrl}
      </Text>
      <Text style={emailStyles.subtle}>{content.ignore}</Text>
    </EmailLayout>
  )
}

export default AuthActionEmail
