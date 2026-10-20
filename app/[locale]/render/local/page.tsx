import type { Metadata } from 'next'
import { LocalRenderHost } from '@/components/design/LocalRenderHost'

export const metadata: Metadata = { robots: { follow: false, index: false } }

/**
 * The editor's render frame. It holds no data of its own: it draws only the
 * documents its same-origin parent sends it.
 */
export default async function LocalRenderPage({
  searchParams,
}: {
  searchParams: Promise<{ print?: string }>
}) {
  const { print } = await searchParams
  return <LocalRenderHost print={print === '1'} />
}
