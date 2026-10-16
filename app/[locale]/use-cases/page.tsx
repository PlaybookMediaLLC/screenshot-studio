import { UseCasesPage } from '@/components/platform-landing/pages/UseCasesPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/use-cases')

export default function Page() {
  return <UseCasesPage />
}
