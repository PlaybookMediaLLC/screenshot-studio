import { ChangelogEmailPage } from '@/components/platform-landing/pages/ChangelogEmailPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/use-cases/changelog-and-email')

export default function Page() {
  return <ChangelogEmailPage />
}
