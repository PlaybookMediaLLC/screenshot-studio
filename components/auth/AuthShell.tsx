import type { ReactNode } from 'react'
import Link from 'next/link'

type AuthShellProps = {
  children: ReactNode
  description: string
  title: string
}

export function AuthShell({ children, description, title }: AuthShellProps) {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-foreground p-12 text-background lg:flex">
        <Link className="text-lg font-semibold" href="/landing">
          Screenshot Studio
        </Link>
        <div className="max-w-md">
          <p className="text-sm font-medium text-background/70">Marketing assets, ready to ship</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight">
            Create on-brand product content with your team.
          </h2>
          <p className="mt-5 text-base leading-7 text-background/70">
            Turn releases, screenshots, and product updates into content your audience can use.
          </p>
        </div>
        <p className="text-sm text-background/60">Secure workspaces with role-based access.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-md">
          <Link
            className="text-sm text-muted-foreground hover:text-foreground lg:hidden"
            href="/landing"
          >
            ← Screenshot Studio
          </Link>
          <h1 className="mt-10 text-3xl font-semibold tracking-tight lg:mt-0">{title}</h1>
          <p className="mt-2 text-muted-foreground">{description}</p>
          <div className="mt-8 rounded-xl border bg-card p-6 shadow-sm">{children}</div>
        </div>
      </section>
    </main>
  )
}
