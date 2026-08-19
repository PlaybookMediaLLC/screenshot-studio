import { Button, Section, Text } from '@react-email/components'
import { EmailLayout, emailStyles } from './layout'

export interface InvitationEmailProps {
  acceptUrl: string
  inviterName: string
  organizationName: string
}

/**
 * Organization invitation.
 *
 * Transactional: the recipient has no account yet and is reachable only
 * by email, so this carries no unsubscribe link. The raw URL is repeated
 * beneath the button because clients that strip anchors otherwise leave
 * the recipient with no way to act.
 */
export function InvitationEmail({
  acceptUrl,
  inviterName,
  organizationName,
}: InvitationEmailProps) {
  return (
    <EmailLayout preview={`Join ${organizationName} on Screenshot Studio`}>
      <Text style={emailStyles.heading}>Join {organizationName}</Text>
      <Text style={emailStyles.paragraph}>
        {inviterName} invited you to the {organizationName} workspace on Screenshot Studio, where
        your team turns releases into launch-ready screenshots, posts, and video.
      </Text>
      <Section style={{ margin: '24px 0' }}>
        <Button href={acceptUrl} style={emailStyles.button}>
          Accept invitation
        </Button>
      </Section>
      <Text style={emailStyles.subtle}>
        If the button does not work, paste this link into your browser: {acceptUrl}
      </Text>
    </EmailLayout>
  )
}

export default InvitationEmail
