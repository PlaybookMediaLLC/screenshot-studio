import { ApprovalsPage } from '@/components/platform-landing/pages/ApprovalsPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/product/approvals')

export default function Page() {
  return <ApprovalsPage />
}
