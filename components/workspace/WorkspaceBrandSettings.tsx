'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { Group, Pill, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

type BrandKitSummary = { id: string; name: string; status: string; version: number }

type WorkspaceBrandSettingsProps = { canManage: boolean }

export function WorkspaceBrandSettings({ canManage }: WorkspaceBrandSettingsProps) {
  const trpcClient = useTRPCClient()
  const [brandKits, setBrandKits] = useState<BrandKitSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    trpcClient.brandKit.list
      .query()
      .then((result) => setBrandKits(result.brandKits))
      .catch((requestError) => setError(getErrorMessage(requestError)))
  }, [trpcClient])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    setIsSaving(true)
    try {
      await trpcClient.brandKit.create.mutate({
        definition: {
          colors: {
            accent: String(data.accent ?? ''),
            background: String(data.background ?? ''),
            foreground: String(data.foreground ?? ''),
          },
          typography: { fontFamily: String(data.fontFamily ?? '') },
        },
        name: String(data.name ?? ''),
        publish: true,
      })
      const result = await trpcClient.brandKit.list.query()
      setBrandKits(result.brandKits)
      form.reset()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <Section title="Saved brand kits">
        <Group>
          {brandKits.length === 0 ? (
            <Row>
              <p className="text-sm text-neutral-500">No brand kits have been created.</p>
            </Row>
          ) : (
            brandKits.map((brandKit) => (
              <div className="flex items-center justify-between gap-4 px-5 py-4" key={brandKit.id}>
                <span className="min-w-0 truncate text-sm text-white">{brandKit.name}</span>
                <Pill tone={brandKit.status.toLowerCase() === 'active' ? 'green' : 'gray'}>
                  v{brandKit.version} · {brandKit.status.toLowerCase()}
                </Pill>
              </div>
            ))
          )}
        </Group>
      </Section>
      {canManage ? (
        <Section title="Create a new active version">
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <Group>
              <Row label={<label htmlFor="brand-name">Brand kit name</label>}>
                <Input className="h-10 rounded-lg md:w-72" id="brand-name" name="name" required />
              </Row>
              <Row description="Hex values, like #6d5dfc." label="Colors" layout="stacked">
                <div className="grid w-full gap-3 sm:grid-cols-3">
                  <ColorField
                    defaultValue="#111111"
                    id="brand-foreground"
                    label="Text"
                    name="foreground"
                  />
                  <ColorField
                    defaultValue="#ffffff"
                    id="brand-background"
                    label="Background"
                    name="background"
                  />
                  <ColorField
                    defaultValue="#6d5dfc"
                    id="brand-accent"
                    label="Accent"
                    name="accent"
                  />
                </div>
              </Row>
              <Row label={<label htmlFor="brand-font-family">Primary typeface</label>}>
                <Input
                  className="h-10 rounded-lg md:w-72"
                  id="brand-font-family"
                  name="fontFamily"
                  placeholder="Inter"
                  required
                />
              </Row>
            </Group>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end">
              <Button className="rounded-lg" disabled={isSaving} type="submit">
                {isSaving ? 'Publishing…' : 'Publish brand kit'}
              </Button>
            </div>
          </form>
        </Section>
      ) : null}
    </div>
  )
}

function ColorField({
  defaultValue,
  id,
  label,
  name,
}: {
  defaultValue: string
  id: string
  label: string
  name: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-neutral-400" htmlFor={id}>
        {label}
      </label>
      <Input
        className="h-10 rounded-lg font-mono"
        defaultValue={defaultValue}
        id={id}
        name={name}
        pattern="#[0-9A-Fa-f]{6}"
        required
        type="text"
      />
    </div>
  )
}
