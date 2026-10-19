'use client'

import { Activity, Suspense, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { EditorLayout } from '@/components/editor/EditorLayout'
import { StoreWorkspaceLoading } from '@/components/store-screenshots/StoreWorkspaceLoading'

const StoreStudio = dynamic(
  () =>
    import('@/components/store-screenshots/studio/StoreStudio').then(
      (module) => module.StoreStudio
    ),
  {
    ssr: false,
    loading: () => <StoreWorkspaceLoading variant="templates" />,
  }
)

function Workspace() {
  const appStore = useSearchParams().get('editor') === 'app-store'
  const [visitedStore, setVisitedStore] = useState(appStore)
  if (appStore && !visitedStore) setVisitedStore(true)
  return (
    <>
      <Activity mode={appStore ? 'hidden' : 'visible'}>
        <EditorLayout />
      </Activity>
      <Activity mode={appStore ? 'visible' : 'hidden'}>
        {visitedStore ? <StoreStudio projectParam="storeProject" /> : null}
      </Activity>
    </>
  )
}

/** Retain documents, selection and history; hidden editors release their global listeners. */
export function EditorWorkspace() {
  return (
    <Suspense fallback={<StoreWorkspaceLoading variant="templates" />}>
      <Workspace />
    </Suspense>
  )
}
