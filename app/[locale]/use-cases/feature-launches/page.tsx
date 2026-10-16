import { FeatureLaunchesPage } from '@/components/platform-landing/pages/FeatureLaunchesPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/use-cases/feature-launches')

export default function Page() {
  return <FeatureLaunchesPage />
}
