/**
 * Run the link preview check outside the app: from a shell, a GitHub Actions
 * workflow after each deploy, or a Node script, failing when a page scores
 * below the bar or has an error.
 */

/** What the generated checks test, and against which API. */
export type AutomationOptions = {
  /** Origin of this app, such as https://shots.playbookmedia.io. */
  apiOrigin: string
  urls: string[]
  minScore: number
  failOnErrors: boolean
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

/** One request, with the API key from the environment. */
export function curlSnippet({ apiOrigin, urls }: AutomationOptions): string {
  return [
    'curl -fsS --get \\',
    '  -H "X-API-Key: $SCREENSHOT_STUDIO_API_KEY" \\',
    `  --data-urlencode ${quote(`url=${urls[0] ?? 'https://example.com/'}`)} \\`,
    `  ${quote(`${apiOrigin}/api/v1/link-preview`)} \\`,
    '  | jq \'{score, errors: [.issues[] | select(.severity == "error") | .title]}\'',
  ].join('\n')
}

/** A workflow that checks each URL after every successful deploy, and on demand. */
export function githubActionsSnippet({
  apiOrigin,
  failOnErrors,
  minScore,
  urls,
}: AutomationOptions): string {
  const list = (urls.length ? urls : ['https://example.com/']).map(quote).join(' ')
  return `name: Link previews

on:
  deployment_status:
  workflow_dispatch:

jobs:
  link-previews:
    if: github.event_name == 'workflow_dispatch' || github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - name: Check how links preview
        env:
          SCREENSHOT_STUDIO_API_KEY: \${{ secrets.SCREENSHOT_STUDIO_API_KEY }}
        run: |
          failed=0
          for url in ${list}; do
            report=$(curl -fsS --get -H "X-API-Key: $SCREENSHOT_STUDIO_API_KEY" \\
              --data-urlencode "url=$url" ${quote(`${apiOrigin}/api/v1/link-preview`)})
            score=$(echo "$report" | jq .score)
            errors=$(echo "$report" | jq '[.issues[] | select(.severity == "error")] | length')
            echo "$url: score $score, $errors errors"
            echo "$report" | jq -r '.issues[] | select(.severity == "error") | "  - " + .title'
            if [ "$score" -lt ${minScore} ]${failOnErrors ? ' || [ "$errors" -gt 0 ]' : ''}; then failed=1; fi
          done
          exit $failed
`
}

/** The same check as a dependency-free Node script (Node 18 or later). */
export function nodeSnippet({
  apiOrigin,
  failOnErrors,
  minScore,
  urls,
}: AutomationOptions): string {
  return `// check-link-previews.mjs: node check-link-previews.mjs
const urls = ${JSON.stringify(urls.length ? urls : ['https://example.com/'], null, 2)}
let failed = false

for (const url of urls) {
  const endpoint = new URL('/api/v1/link-preview', ${JSON.stringify(apiOrigin)})
  endpoint.searchParams.set('url', url)
  const response = await fetch(endpoint, {
    headers: { 'X-API-Key': process.env.SCREENSHOT_STUDIO_API_KEY },
  })
  const report = await response.json()
  if (!response.ok) throw new Error(\`\${url}: \${report.message}\`)
  const errors = report.issues.filter((issue) => issue.severity === 'error')
  console.log(\`\${url}: score \${report.score}, \${errors.length} errors\`)
  for (const issue of errors) console.log(\`  - \${issue.title}: \${issue.fix}\`)
  if (report.score < ${minScore}${failOnErrors ? ' || errors.length > 0' : ''}) failed = true
}

process.exit(failed ? 1 : 0)
`
}
