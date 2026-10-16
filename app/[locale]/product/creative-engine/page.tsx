import { CreativeEnginePage } from '@/components/platform-landing/pages/CreativeEnginePage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/product/creative-engine')

export default function Page() {
  return <CreativeEnginePage />
}
