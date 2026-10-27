import { ProductMarketingPage } from '@/components/platform-landing/pages/ProductMarketingPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/solutions/product-marketing')

export default function Page() {
  return <ProductMarketingPage />
}
