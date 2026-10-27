import { completeGitHubConnection, githubSettingsUrl } from '@/lib/tenant/github'

/** GitHub's authorization callback: link the verified installation. */
export async function GET(request: Request): Promise<Response> {
  let destination: string
  try {
    destination = await completeGitHubConnection(request.headers, new URL(request.url).searchParams)
  } catch {
    destination = githubSettingsUrl('failed')
  }
  return new Response(null, {
    headers: { 'Cache-Control': 'no-store', Location: destination },
    status: 303,
  })
}
