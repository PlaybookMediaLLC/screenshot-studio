'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { z } from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage, requestJson } from './settings-client'

const brandKitSchema = z.object({
  brandKits: z.array(
    z.object({ id: z.string(), name: z.string(), status: z.string(), version: z.number() })
  ),
})

type WorkspaceBrandSettingsProps = { canManage: boolean }

export function WorkspaceBrandSettings({ canManage }: WorkspaceBrandSettingsProps) {
  const [brandKits, setBrandKits] = useState<z.infer<typeof brandKitSchema>['brandKits']>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    requestJson('/api/tenant/brand-kits', brandKitSchema)
      .then((result) => setBrandKits(result.brandKits))
      .catch((requestError) => setError(getErrorMessage(requestError)))
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    setIsSaving(true)
    try {
      await requestJson('/api/tenant/brand-kits', z.unknown(), {
        body: {
          definition: {
            colors: {
              accent: data.accent,
              background: data.background,
              foreground: data.foreground,
            },
            typography: { fontFamily: data.fontFamily },
          },
          name: data.name,
          publish: true,
        },
        method: 'POST',
      })
      const result = await requestJson('/api/tenant/brand-kits', brandKitSchema)
      setBrandKits(result.brandKits)
      form.reset()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="grid max-w-2xl gap-8">
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold">Saved brand kits</h3>
        {brandKits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No brand kits have been created.</p>
        ) : (
          <ul className="grid gap-2">
            {brandKits.map((brandKit) => (
              <li
                className="flex items-center justify-between rounded-md border border-foreground/10 bg-background px-3 py-2 text-sm"
                key={brandKit.id}
              >
                <span>{brandKit.name}</span>
                <Badge variant="outline">
                  v{brandKit.version} · {brandKit.status.toLowerCase()}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
      {canManage ? (
        <form className="grid gap-4 border-t border-foreground/10 pt-6" onSubmit={handleSubmit}>
          <h3 className="text-sm font-semibold">Create a new active version</h3>
          <Label className="grid gap-1.5" htmlFor="brand-name">
            Brand kit name
            <Input id="brand-name" name="name" required />
          </Label>
          <div className="grid gap-4 sm:grid-cols-3">
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
            <ColorField defaultValue="#6d5dfc" id="brand-accent" label="Accent" name="accent" />
          </div>
          <Label className="grid gap-1.5" htmlFor="brand-font-family">
            Primary typeface
            <Input id="brand-font-family" name="fontFamily" placeholder="Inter" required />
          </Label>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button className="w-fit" disabled={isSaving} type="submit">
            {isSaving ? 'Publishing…' : 'Publish brand kit'}
          </Button>
        </form>
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
    <Label className="grid gap-1.5" htmlFor={id}>
      {label}
      <Input
        defaultValue={defaultValue}
        id={id}
        name={name}
        pattern="#[0-9A-Fa-f]{6}"
        required
        type="text"
      />
    </Label>
  )
}
