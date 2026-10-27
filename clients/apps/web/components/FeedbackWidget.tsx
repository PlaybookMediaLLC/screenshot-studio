'use client'

import Script from 'next/script'

// The widget project id is deployment-specific. Without one configured,
// the embed script requests a nonexistent project on every page, so the
// widget renders nothing instead.
const project = process.env.NEXT_PUBLIC_PALMFRAME_PROJECT

export function FeedbackWidget() {
  if (!project) {
    return null
  }

  return (
    <>
      <Script src="https://cdn.palmframe.com/embed.js" strategy="lazyOnload" />
      <palmframe-widget project={project} />
    </>
  )
}
