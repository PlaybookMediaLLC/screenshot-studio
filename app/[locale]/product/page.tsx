import { ProductPage } from '@/components/platform-landing/pages/ProductPage'
import { platformMetadata } from '@/lib/marketing/platform-pages'

export const metadata = platformMetadata('/product')

export default function Page() {
  return <ProductPage />
}
