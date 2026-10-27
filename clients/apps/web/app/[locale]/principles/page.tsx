import { PrinciplesPage } from '@/components/platform-landing/pages/PrinciplesPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/principles')

export default function Page() {
  return <PrinciplesPage />
}
