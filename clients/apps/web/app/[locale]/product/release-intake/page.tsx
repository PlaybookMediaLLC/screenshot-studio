import { ReleaseIntakePage } from '@/components/platform-landing/pages/ReleaseIntakePage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/product/release-intake')

export default function Page() {
  return <ReleaseIntakePage />
}
