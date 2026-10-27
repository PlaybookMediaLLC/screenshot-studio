import { DeveloperToolsPage } from '@/components/platform-landing/pages/DeveloperToolsPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/solutions/developer-tools')

export default function Page() {
  return <DeveloperToolsPage />
}
