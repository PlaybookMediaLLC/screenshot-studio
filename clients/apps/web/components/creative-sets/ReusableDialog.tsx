'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ProjectPreview } from '@/components/projects/ProjectPreview'
import {
  applyReusable,
  detachReusable,
  reusableDefinition,
  reusableOverrides,
  resetReusableField,
} from '@/lib/creative-sets/reusable'
import {
  reusableDefinitionSchema,
  reusableScopeSchema,
  type ReusableDefinition,
} from '@/lib/creative-sets/reusable-schema'
import type { CreativeSetDocument } from '@/lib/creative-sets/document'
import type { CreativeSetSession } from '@/lib/creative-sets/session'

type Template = {
  id: string
  name: string
  version: number
  definition: Record<string, unknown>
  status: string
}
const labels = {
  composition: 'Complete composition',
  headline: 'Headline block',
  'proof-detail': 'Proof detail block',
}

export function ReusableDialog({
  session,
  outputId,
  onClose,
}: {
  session: CreativeSetSession
  outputId: string
  onClose: () => void
}) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [name, setName] = useState(''),
    [scope, setScope] = useState<ReusableDefinition['scope']>('composition')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<{
    before: CreativeSetDocument
    after: CreativeSetDocument
  } | null>(null)
  const output = session.snapshot().document.outputs.find((output) => output.id === outputId)!
  useEffect(() => {
    let active = true
    void session.client.creativeTemplate.list
      .query()
      .then(({ templates }) => {
        if (active) setTemplates(templates)
      })
      .catch((error) => {
        if (active) setError(error.message)
      })
    return () => {
      active = false
    }
  }, [session])
  function preview(template: Template, reset = false) {
    try {
      const before = session.snapshot().document
      setProposal({ before, after: applyReusable(before, outputId, template, reset) })
      setError(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'This version cannot be applied.')
    }
  }
  async function publish() {
    setBusy(true)
    setError(null)
    try {
      if (!(await session.save())) throw new Error('Save your set before publishing a block.')
      const current = session.snapshot().document.outputs.find((output) => output.id === outputId)!
      const definition = reusableDefinition(current, scope, name.trim())
      const { template } = await session.client.creativeTemplate.create.mutate({
        name: name.trim(),
        definition: JSON.parse(JSON.stringify(definition)),
      })
      setTemplates((templates) => [...templates, template])
      preview(template)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Publishing failed.')
    } finally {
      setBusy(false)
    }
  }
  const latest = templates
    .filter(
      (template) =>
        template.status !== 'ARCHIVED' &&
        !templates.some((other) => other.name === template.name && other.version > template.version)
    )
    .filter((template) => {
      const parsed = reusableDefinitionSchema.safeParse(template.definition)
      return parsed.success && parsed.data.format === output.format
    })
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
        <DialogTitle>Reusable visual treatments</DialogTitle>
        <DialogDescription>
          Save a treatment for your next story, or preview a published version. Your custom copy,
          placement and styling stay intact.
        </DialogDescription>
        {!proposal ? (
          <>
            {output.reusable.map((reference) => (
              <div
                key={reference.scope}
                className="flex flex-wrap items-center gap-2 rounded border p-3 text-sm"
              >
                <span className="flex-1">
                  {reference.name} · v{reference.version} · {labels[reference.scope]}
                </span>
                {reusableOverrides(output, reference.scope).map((field) => (
                  <Button
                    key={`${field.owner}:${field.path.join('.')}`}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const before = session.snapshot().document
                      try {
                        setProposal({
                          before,
                          after: resetReusableField(before, outputId, reference.scope, field),
                        })
                      } catch (error) {
                        setError(error instanceof Error ? error.message : 'Reset failed.')
                      }
                    }}
                  >
                    Reset {field.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    session.commit(
                      detachReusable(session.snapshot().document, outputId, reference.scope)
                    )
                    onClose()
                  }}
                >
                  Detach
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const template = templates.find((template) => template.id === reference.id)
                    if (template) preview(template, true)
                  }}
                >
                  Reset block overrides…
                </Button>
              </div>
            ))}
            <div className="space-y-2">
              {latest.map((template) => (
                <Button
                  key={template.id}
                  variant="outline"
                  className="w-full justify-between"
                  onClick={() => preview(template)}
                >
                  <span>{template.name}</span>
                  <span>Preview v{template.version}</span>
                </Button>
              ))}
            </div>
            <div className="grid gap-3 rounded border p-3">
              <Label className="grid gap-1 text-sm">
                Publish from this output
                <Select
                  value={scope}
                  onValueChange={(value) => setScope(reusableScopeSchema.parse(value))}
                >
                  <SelectTrigger aria-label="Publish from this output" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {reusableScopeSchema.options.map((scope) => (
                      <SelectItem key={scope} value={scope}>
                        {labels[scope]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1 text-sm">
                Published name
                <Input
                  value={name}
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Feature proof"
                />
              </Label>
              <p className="text-xs text-muted-foreground">
                Use an existing name to publish its next version. Named slots: headline, supporting
                copy and product proof.
              </p>
              <Button disabled={busy || !name.trim()} onClick={() => void publish()}>
                Publish version
              </Button>
            </div>
          </>
        ) : null}
        {proposal ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Before', proposal.before],
                ['After', proposal.after],
              ].map(([label, set]) => (
                <div key={label as string}>
                  <p className="text-sm">{label as string}</p>
                  <div className="mt-3 aspect-square rounded-lg border bg-foreground/[0.03] p-3">
                    <ProjectPreview
                      alt={label as string}
                      document={
                        (set as CreativeSetDocument).outputs.find(
                          (output) => output.id === outputId
                        )!.document
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setProposal(null)}>
                Discard
              </Button>
              <Button
                onClick={() => {
                  if (
                    JSON.stringify(session.snapshot().document) !== JSON.stringify(proposal.before)
                  ) {
                    setError('The set changed. Preview this version again before applying.')
                    return
                  }
                  session.commit(proposal.after)
                  onClose()
                }}
              >
                Keep
              </Button>
            </div>
          </div>
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
