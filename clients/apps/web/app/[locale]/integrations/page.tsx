import { IntegrationsPage } from '@/components/platform-landing/pages/IntegrationsPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/integrations')

export default function Page() {
  return <IntegrationsPage />
}
