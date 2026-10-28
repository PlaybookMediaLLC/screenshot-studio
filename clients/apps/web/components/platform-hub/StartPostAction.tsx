'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useNewPost } from '@/components/write/pending-draft'

/** A Home starter that makes the post at once, as New → Post does. */
export function StartPostAction({ children }: { children: ReactNode }) {
  const newPost = useNewPost()
  return (
    <Button
      className="home-action group w-full text-start"
      onClick={newPost}
      size={null}
      type="button"
      variant="custom"
    >
      {children}
    </Button>
  )
}
