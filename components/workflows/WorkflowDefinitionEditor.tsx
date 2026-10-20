'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ButtonLink } from '@/components/platform-shell/ButtonLink'
import { Page } from '@/components/platform-ui'
import { getErrorMessage } from '@/components/workspace/settings-client'
import type {
  AutomationDefinition,
  AutomationHistoryItem,
  AutomationOverview,
} from '@/lib/api/contracts/release-automation'
import { useTRPCClient } from '@/lib/trpc/react'
import { WorkflowEditor } from './WorkflowEditor'

/** Loads one persisted definition into the editor at its own URL. */
export function WorkflowDefinitionEditor({ canManage, id }: { canManage: boolean; id: string }) {
  const client = useTRPCClient()
  const router = useRouter()
  const [state, setState] = useState<{
    definition: AutomationDefinition
    history: AutomationHistoryItem[]
    overview: AutomationOverview
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const overview = await client.releaseAutomation.overview.query()
        const definition = overview.definitions.find((candidate) => candidate.id === id)
        if (!definition) {
          setError('This workflow does not exist in this workspace.')
          return
        }
        const history = await client.releaseAutomation.history.query({
          sourceAppId: definition.sourceAppId,
          family: definition.draft.family,
        })
        setState({ definition, history: history.items, overview })
      } catch (failure) {
        setError(getErrorMessage(failure))
      }
    })()
  }, [client, id])

  if (!state) {
    return (
      <Page
        actions={
          <ButtonLink href="/workflows" variant="outline">
            All workflows
          </ButtonLink>
        }
        title="Workflow"
      >
        <p
          className={error ? 'text-sm text-red-300' : 'text-sm text-neutral-500'}
          role={error ? 'alert' : 'status'}
        >
          {error ?? 'Loading workflow…'}
        </p>
      </Page>
    )
  }
  return (
    <WorkflowEditor
      definition={state.definition}
      history={state.history}
      onClose={() => router.push('/workflows')}
      onSaved={() => undefined}
      overview={state.overview}
      readOnly={!canManage}
    />
  )
}
