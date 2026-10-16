import { EnterprisePage } from '@/components/platform-landing/pages/EnterprisePage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/enterprise')

export default function Page() {
  return <EnterprisePage />
}
