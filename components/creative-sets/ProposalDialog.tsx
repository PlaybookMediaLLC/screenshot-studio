'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { applyStoryProposal } from '@/lib/creative-sets/proposals'
import type { CreativeSetSession } from '@/lib/creative-sets/session'
import type { CreativeSetDocument } from '@/lib/creative-sets/document'
import { ChangeComparison } from './StorySetChanges'

export function ProposalDialog({
  session,
  outputId,
  onClose,
}: {
  session: CreativeSetSession
  outputId: string
  onClose: () => void
}) {
  const output = session.snapshot().document.outputs.find((output) => output.id === outputId)!
  const story = session.snapshot().document.stories.find((story) => story.id === output.storyId)!
  const [scope, setScope] = useState<'story' | 'output'>('output')
  const [facts, setFacts] = useState(`${story.headline}. ${story.supporting}`.trim())
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const [before, setBefore] = useState<CreativeSetDocument | null>(null)
  const [proposals, setProposals] = useState<
    Array<{ headline: string; reason: string; document: CreativeSetDocument }>
  >([])
  const [selected, setSelected] = useState<number | null>(null)
  async function propose() {
    setBusy(true)
    setError(null)
    setProposals([])
    setSelected(null)
    try {
      if (!(await session.save())) throw new Error('Save the set before requesting proposals.')
      const state = session.snapshot()
      const request = {
        creativeSetId: session.record.id,
        baseRevision: state.revision,
        storyId: story.id,
        outputId,
        scope,
        facts,
      }
      const result = await session.client.creativeSet.proposeCopy.mutate(request)
      setBefore(state.document)
      setProposals(
        result.proposals.map((proposal) => ({
          headline: proposal.headline,
          reason: proposal.reason,
          document: applyStoryProposal(state.document, request, proposal),
        }))
      )
      if (!result.proposals.length)
        setError('No supported proposal was returned. Add clearer product facts and try again.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Proposal failed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-4xl">
        <DialogTitle>Propose shorter copy</DialogTitle>
        <DialogDescription>
          Selected story: {story.headline}. Only the facts below are sent to the copy service.
          Review meaning before keeping a proposal.
        </DialogDescription>
        <label className="grid gap-1 text-sm">
          Editing scope
          <select
            disabled={busy}
            className="rounded border bg-background p-2"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as 'story' | 'output')
              setProposals([])
              setSelected(null)
            }}
          >
            <option value="output">This format · create a local override</option>
            <option value="story">Story · update linked formats</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Supplied product facts
          <Textarea
            maxLength={3000}
            value={facts}
            onChange={(event) => setFacts(event.target.value)}
            disabled={busy}
          />
        </label>
        <Button disabled={busy || facts.trim().length < 20} onClick={() => void propose()}>
          {busy ? 'Proposing…' : 'Request proposals'}
        </Button>
        {proposals.map((proposal, index) => (
          <button
            key={index}
            className="rounded border p-3 text-left"
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
          >
            <strong>{proposal.headline}</strong>
            <p className="text-sm text-muted-foreground">{proposal.reason}</p>
          </button>
        ))}
        {selected !== null && before ? (
          <>
            <ChangeComparison
              before={before}
              after={proposals[selected]!.document}
              storyId={story.id}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Discard
              </Button>
              <Button
                onClick={() => {
                  if (JSON.stringify(session.snapshot().document) !== JSON.stringify(before)) {
                    setError('The set changed. Request a new proposal before applying.')
                    return
                  }
                  session.commit(proposals[selected]!.document)
                  onClose()
                }}
              >
                Keep
              </Button>
            </div>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
