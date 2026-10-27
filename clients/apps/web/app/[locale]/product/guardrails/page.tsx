import { GuardrailsPage } from '@/components/platform-landing/pages/GuardrailsPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/product/guardrails')

export default function Page() {
  return <GuardrailsPage />
}
