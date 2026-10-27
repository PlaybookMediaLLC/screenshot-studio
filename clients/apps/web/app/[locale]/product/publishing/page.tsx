import { PublishingPage } from '@/components/platform-landing/pages/PublishingPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/product/publishing')

export default function Page() {
  return <PublishingPage />
}
