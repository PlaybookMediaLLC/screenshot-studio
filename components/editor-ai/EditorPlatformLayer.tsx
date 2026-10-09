'use client'

import { WorkspaceAssetLoader } from '@/components/workspace/WorkspaceAssetLoader'
import { WorkspaceDesignLoader } from '@/components/workspace/WorkspaceDesignLoader'
import { EditorAiPanel } from './EditorAiPanel'

/**
 * Everything the platform adds to the upstream editor, behind one mount
 * point: workspace deep links (?asset=, ?design=) and the AI panel. Keeping
 * it to a single line in EditorLayout keeps upstream merges conflict-free.
 */
export function EditorPlatformLayer() {
  return (
    <>
      <WorkspaceAssetLoader />
      <WorkspaceDesignLoader />
      <EditorAiPanel />
    </>
  )
}
