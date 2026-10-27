import { SecurityPage } from '@/components/platform-landing/pages/SecurityPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/security')

export default function Page() {
  return <SecurityPage />
}
