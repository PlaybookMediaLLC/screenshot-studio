'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useTRPCClient } from '@/lib/trpc/react'

/** A useful next step and a static example for workspaces awaiting early access. */
export function StorySetAccess() {
  const client = useTRPCClient()
  const [projects, setProjects] = useState<{ count: number; more: boolean } | null>(null)
  useEffect(() => {
    let active = true
    void client.project.list
      .query({ limit: 3 })
      .then((page) => {
        if (active) setProjects({ count: page.items.length, more: Boolean(page.nextCursor) })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [client])
  return (
    <section
      aria-labelledby="story-set-access"
      className="space-y-6 rounded-xl border bg-foreground/[0.02] p-5 sm:p-6"
    >
      <div className="max-w-2xl space-y-3">
        <h2 id="story-set-access" className="text-xl font-semibold">
          One benefit. Three connected formats.
        </h2>
        <p className="text-sm text-muted-foreground">
          Turn a product screenshot into a wide launch visual, a square card and a portrait post.
          New Story Sets are available to design partners. Saved sets remain available here.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link prefetch={false} href="/contact">
              Request design-partner access
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link prefetch={false} href="/design-partners">
              About the program
            </Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {projects && projects.count > 0
            ? `You have ${projects.more ? 'at least ' : ''}${projects.count} saved ${projects.count === 1 ? 'project' : 'projects'} you can copy into Story Sets once access is enabled.`
            : 'You can keep working in Projects and copy a saved design into a Story Set once access is enabled.'}{' '}
          <Link prefetch={false} href="/projects" className="underline underline-offset-4">
            View Projects
          </Link>
        </p>
      </div>
      <div aria-label="Example Story Set" className="border-t pt-5">
        <p className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Example · Your team’s work, together
        </p>
        <div className="grid max-w-3xl grid-cols-3 items-end gap-2 sm:gap-4">
          {[
            { label: 'Wide', dimensions: '1600 × 900', aspect: 'aspect-video' },
            { label: 'Square', dimensions: '1080 × 1080', aspect: 'aspect-square' },
            { label: 'Portrait', dimensions: '1080 × 1350', aspect: 'aspect-[4/5]' },
          ].map(({ label, dimensions, aspect }) => (
            <figure key={label} className="min-w-0">
              <div
                className={`${aspect} flex flex-col justify-center gap-1 overflow-hidden sm:gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 sm:p-4`}
              >
                <p className="hidden font-semibold sm:block sm:text-sm">
                  Your team’s work, together
                </p>
                <Image
                  src="/demo/notion-showcase.webp"
                  alt="Example product screenshot"
                  loading="eager"
                  width={640}
                  height={360}
                  className="min-h-0 rounded border object-contain"
                />
              </div>
              <figcaption className="mt-2 text-xs text-muted-foreground">
                {label}
                <span className="hidden sm:inline"> · {dimensions}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
