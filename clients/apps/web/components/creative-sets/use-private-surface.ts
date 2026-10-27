'use client'

import { useEffect } from 'react'

let owners = 0
let alreadyBlocked = false

/** Block automatic DOM capture and replay, including dialogs rendered in portals. */
export function usePrivateCreativeSurface() {
  useEffect(() => {
    if (owners++ === 0) {
      alreadyBlocked = document.body.classList.contains('ph-no-capture')
      document.body.classList.add('ph-no-capture')
    }
    return () => {
      if (--owners === 0 && !alreadyBlocked) document.body.classList.remove('ph-no-capture')
    }
  }, [])
}
