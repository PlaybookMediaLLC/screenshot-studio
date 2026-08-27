import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { EditorLayout } from '@/components/editor/EditorLayout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AgentSummary } from '@/components/seo/AgentSummary'
import { getLocalizedPath, getPageAccess } from '@/lib/auth/page-access'
import { OG_DEFAULTS } from '@/lib/seo/metadata'

export const metadata: Metadata = {
  title: 'Screenshot Studio - Free Screenshot Editor & Mockup Maker',
  description:
    'Screenshot editor and mockup maker for product marketing teams. Add browser mockups, 3D effects, animations, and brand styling to your screenshots.',
  keywords: [
    'screenshot editor online free',
    'free screenshot editor',
    'online image editor',
    'screenshot beautifier online',
    'screenshot mockup tool',
    'pika style alternative',
    'shots.so alternative',
    'browser mockup generator',
    'safari browser mockup',
    'chrome browser mockup',
    'browser frame screenshot',
    'screenshot wrapper tool',
    'add background to screenshot free',
    'tweet to screenshot',
    'code snippet screenshot',
    'code to image generator',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Screenshot Studio - Free Screenshot Editor & Mockup Maker',
    description:
      'Free screenshot editor online — add backgrounds, shadows, 3D effects, and animations. Export as PNG, JPG, or video.',
    url: '/',
  },
}

type EditorPageProps = {
  params: Promise<{ locale: string }>
}

export default async function EditorPage({ params }: EditorPageProps) {
  const [{ locale }, requestHeaders] = await Promise.all([params, headers()])
  const access = await getPageAccess(requestHeaders)
  if (!access) redirect(getLocalizedPath(locale, '/sign-in'))
  if (!access.hasOrganization) redirect(getLocalizedPath(locale, '/onboarding'))
  if (!access.isWorkspaceOperational) redirect(getLocalizedPath(locale, '/workspace'))

  return (
    <>
      <AgentSummary />
      <ErrorBoundary>
        <EditorLayout />
      </ErrorBoundary>
    </>
  )
}
