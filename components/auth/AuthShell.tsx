import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'

type AuthShellProps = {
  children: ReactNode
  description: string
  /** Small label above the title, e.g. "Step 1 of 2". */
  eyebrow?: string
  footer?: ReactNode
  title: string
}

/**
 * Auth pages after Polar's: one borderless card on a flat near-black page,
 * a large logo, a light title, and the terms underneath.
 */
export function AuthShell({ children, description, eyebrow, footer, title }: AuthShellProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#090909] px-4 py-12 text-white">
      <div className="flex w-full max-w-md flex-col gap-8 rounded-3xl bg-[#111111] p-8 sm:p-12">
        <header className="flex flex-col gap-4">
          <Link className="w-fit" href="/landing">
            <Image
              alt="Screenshot Studio"
              className="size-12 rounded-xl"
              height={48}
              priority
              src="/logo-mark.png"
              width={48}
            />
          </Link>
          <div className="flex flex-col gap-1.5">
            {eyebrow ? <p className="text-xs font-medium text-neutral-500">{eyebrow}</p> : null}
            <h1 className="text-2xl text-white">{title}</h1>
            <p className="text-lg text-balance text-neutral-400">{description}</p>
          </div>
        </header>
        {children}
      </div>
      {footer ?? (
        <p className="mt-6 max-w-sm text-center text-xs text-balance text-neutral-500">
          By continuing you agree to our{' '}
          <Link className="text-neutral-300 hover:text-white" href="/terms">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link className="text-neutral-300 hover:text-white" href="/privacy-policy">
            Privacy Policy
          </Link>
          .
        </p>
      )}
    </main>
  )
}
