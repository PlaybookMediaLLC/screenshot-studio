import { Pill, Row } from '@/components/platform-ui'
import type { SsoProvider } from './WorkspaceIdentitySettings'

type WorkspaceSsoListProps = { providers: SsoProvider[] }

/** Connected SSO providers as rows of a platform-ui Group. */
export function WorkspaceSsoList({ providers }: WorkspaceSsoListProps) {
  if (providers.length === 0)
    return (
      <Row>
        <p className="text-sm text-neutral-500">No SSO providers are connected.</p>
      </Row>
    )
  return providers.map((provider) => (
    <div className="flex items-center gap-4 px-5 py-4" key={provider.providerId}>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm text-white">{provider.providerId}</p>
        <p className="truncate text-xs text-neutral-500">{provider.domain}</p>
      </div>
      <Pill tone="green">Connected</Pill>
    </div>
  ))
}
