import { PricingPage } from '@/components/platform-landing/pages/PricingPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/pricing')

export default function Page() {
  return <PricingPage />
}
