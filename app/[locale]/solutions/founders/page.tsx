import { FoundersPage } from '@/components/platform-landing/pages/FoundersPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/solutions/founders')

export default function Page() {
  return <FoundersPage />
}
