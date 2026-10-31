'use client'

import Link from 'next/link'
import { useHydratedSession } from '@/lib/auth/client'
import { CtaLink } from './CtaLink'

/**
 * The marketing pages' main call to action. A signed-in visitor, such as one
 * who opened Pricing from the app, gets the way back to the workspace instead
 * of being asked to sign up again. The session is read in the browser, so the
 * marketing pages stay static.
 */
export function GetStartedCta({ className, location }: { className?: string; location: string }) {
  return useHydratedSession().data ? (
    <CtaLink
      className={className}
      href="/"
      label="Open workspace"
      location={`${location}_workspace`}
    />
  ) : (
    <CtaLink className={className} href="/sign-up" label="Get started" location={location} />
  )
}

/** The header's account links: Sign in and Get started, or Open workspace once signed in. */
export function SessionLinks({ placement }: { placement: 'bar' | 'menu' }) {
  const signedIn = Boolean(useHydratedSession().data)
  if (placement === 'menu')
    return (
      <Link
        className="block rounded-lg px-3 py-2 text-[15px] text-white/80 hover:bg-white/[0.05] hover:text-white"
        href={signedIn ? '/' : '/sign-in'}
      >
        {signedIn ? 'Open workspace' : 'Sign in'}
      </Link>
    )
  return (
    <>
      {signedIn ? null : (
        <Link
          className="hidden text-[15px] text-white transition-colors hover:text-white/70 sm:block"
          href="/sign-in"
        >
          Sign in
        </Link>
      )}
      <GetStartedCta
        className="h-10 pl-4 pr-3 text-sm sm:pl-5 sm:pr-4 sm:text-[15px]"
        location="landing_nav"
      />
    </>
  )
}
