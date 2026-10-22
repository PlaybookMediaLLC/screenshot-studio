type Guard = () => Promise<void> | void
const guards = new Map<Guard, boolean>()

/** Register existing editor save/discard behavior; link guards also protect shell navigation. */
export function registerNavigationGuard(guard: Guard, links = false): () => void {
  guards.set(guard, links)
  return () => {
    guards.delete(guard)
  }
}

/** Resolve old-tenant work before changing organization. Rejection keeps it open. */
export async function prepareWorkspaceSwitch(): Promise<void> {
  for (const guard of guards.keys()) await guard()
}

/** Editors with no existing link listener opt into the shell's save-before-leave behavior. */
export function hasLinkNavigationGuards(): boolean {
  return [...guards.values()].some(Boolean)
}

/** Save document work before following a shell link. */
export async function prepareLinkNavigation(): Promise<void> {
  for (const [guard, links] of guards) if (links) await guard()
}
