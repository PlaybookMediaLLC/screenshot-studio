import { LaunchIntelligencePage } from '@/components/platform-landing/pages/LaunchIntelligencePage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/product/launch-intelligence')

export default function Page() {
  return <LaunchIntelligencePage />
}
