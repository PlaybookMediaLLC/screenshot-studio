import type { Metadata } from 'next'
import { PlatformLanding } from '@/components/platform-landing/PlatformLanding'
import { OG_DEFAULTS } from '@/lib/seo/metadata'

const DESCRIPTION =
  'Turn every release into a launch campaign. Screenshot Studio writes a cited launch brief, designs on-brand visuals from your real product, and drafts posts for X, LinkedIn, Instagram, Product Hunt, your changelog, and email. Nothing goes out until you approve it.'

export const metadata: Metadata = {
  title: 'Turn Every Release into a Launch Campaign',
  description: DESCRIPTION,
  keywords: [
    'product launch platform',
    'release announcement tool',
    'launch campaign generator',
    'changelog to social posts',
    'feature announcement',
    'AI launch copy with citations',
    'product marketing for developers',
    'GitHub release to social media',
    'screenshot editor',
    'browser mockup generator',
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Screenshot Studio: Turn every release into a launch',
    description: DESCRIPTION,
    url: '/landing',
  },
  alternates: {
    canonical: '/landing',
  },
}

export default function LandingPageRoute() {
  return <PlatformLanding />
}
