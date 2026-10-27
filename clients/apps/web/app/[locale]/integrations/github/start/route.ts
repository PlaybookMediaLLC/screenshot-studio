import { startGitHubConnection, githubSettingsUrl } from '@/lib/tenant/github'

/** Send an admin to GitHub to install the App, or (`?existing=1`) to link an installation they have. */
export async function GET(request: Request): Promise<Response> {
  let destination: string
  try {
    const existing = new URL(request.url).searchParams.get('existing') === '1'
    destination = await startGitHubConnection(request.headers, existing)
  } catch {
    destination = githubSettingsUrl('failed')
  }
  return new Response(null, {
    headers: { 'Cache-Control': 'no-store', Location: destination },
    status: 303,
  })
}
