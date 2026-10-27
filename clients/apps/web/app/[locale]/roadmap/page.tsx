import { RoadmapPage } from '@/components/platform-landing/pages/RoadmapPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/roadmap')

export default function Page() {
  return <RoadmapPage />
}
