'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { openDesignInEditor } from '@/lib/design/open-design'
import { useTRPCClient } from '@/lib/trpc/react'

/**
 * Opens a stored design in the editor when the URL carries ?design=<id>.
 *
 * Unlike ?asset=, which loads a flat image, this restores the whole
 * composition: template, background, frame, devices, text, overlays and
 * annotations stay individually editable. Workspace images are fetched into
 * blob URLs so the editor's export never sees a cross-origin image.
 */
export function WorkspaceDesignLoader() {
  const trpcClient = useTRPCClient()
  const startedRef = React.useRef(false)

  React.useEffect(() => {
    if (startedRef.current) return
    const designId = new URLSearchParams(window.location.search).get('design')
    if (!designId) return
    startedRef.current = true

    async function load(id: string): Promise<void> {
      const design = await openDesignInEditor(trpcClient, id)
      const url = new URL(window.location.href)
      url.searchParams.delete('design')
      window.history.replaceState(null, '', url)
      toast.success(`Opened “${design.name}”`)
    }

    load(designId).catch(() => {
      toast.error('Could not open the design', {
        description: 'It may have been deleted, or you may not have access to it.',
      })
    })
  }, [trpcClient])

  return null
}
