import { ProductLaunchesPage } from '@/components/platform-landing/pages/ProductLaunchesPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/use-cases/product-launches')

export default function Page() {
  return <ProductLaunchesPage />
}
