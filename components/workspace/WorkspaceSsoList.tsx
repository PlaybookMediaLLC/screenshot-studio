import type { SsoProvider } from './WorkspaceIdentitySettings'

type WorkspaceSsoListProps = { providers: SsoProvider[] }

export function WorkspaceSsoList({ providers }: WorkspaceSsoListProps) {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">Connected SSO providers</h3>
      {providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No SSO providers are connected.</p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-foreground/10">
          {providers.map((provider) => (
            <li
              className="border-b border-foreground/10 px-4 py-3 text-sm last:border-b-0"
              key={provider.providerId}
            >
              <p className="font-medium">{provider.providerId}</p>
              <p className="text-xs text-muted-foreground">{provider.domain}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
