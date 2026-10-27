import { DesignPartnersPage } from '@/components/platform-landing/pages/DesignPartnersPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/design-partners')

export default function Page() {
  return <DesignPartnersPage />
}
