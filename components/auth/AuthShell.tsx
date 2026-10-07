import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'

type AuthShellProps = {
  children: ReactNode
  description: string
  /** Small label above the title, e.g. "Step 2 of 2". */
  eyebrow?: string
  footer?: ReactNode
  title: string
}

function Brand() {
  return (
    <Link className="inline-flex items-center gap-2.5 text-sm font-semibold" href="/landing">
      <Image alt="" className="size-7 rounded-lg" height={28} src="/logo-mark.png" width={28} />
      Screenshot Studio
    </Link>
  )
}

export function AuthShell({ children, description, eyebrow, footer, title }: AuthShellProps) {
  return (
    <main className="grid min-h-screen bg-background text-foreground lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col px-6 py-8 sm:px-12 lg:py-10">
        <Brand />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          {eyebrow ? (
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          <div className="mt-8">{children}</div>
        </div>
        {footer ? <div className="text-xs text-muted-foreground">{footer}</div> : null}
      </section>

      <section className="relative m-3 hidden overflow-hidden rounded-2xl border border-white/10 lg:block">
        <Image alt="" className="object-cover" fill priority sizes="55vw" src="/mesh/Dusk.webp" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <p className="w-fit rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs backdrop-blur">
            Marketing assets, ready to ship
          </p>
          <div className="mx-auto w-full max-w-xl [perspective:1600px]">
            <Image
              alt="A product screenshot framed in Screenshot Studio"
              className="w-full rounded-xl shadow-2xl ring-1 shadow-black/50 ring-white/10 [transform:rotateX(8deg)_rotateY(-10deg)]"
              height={1080}
              priority
              src="/demo/demo-1.png"
              width={1920}
            />
          </div>
          <div className="max-w-md">
            <h2 className="text-3xl leading-tight font-semibold tracking-tight">
              Create on-brand product content with your team.
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/70">
              Turn releases, screenshots, and product updates into content your audience can use.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
