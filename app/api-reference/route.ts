import { ApiReference } from '@scalar/nextjs-api-reference'

export const dynamic = 'force-static'

/** Shots' dark surfaces and borders, so the reference matches the site. */
const SHOTS_THEME = `
  .dark-mode {
    --scalar-background-1: #090909;
    --scalar-background-2: #111111;
    --scalar-background-3: #161616;
    --scalar-border-color: #212121;
    --scalar-color-accent: #ffffff;
    --scalar-button-1: #ffffff;
    --scalar-button-1-color: #0a0a0a;
    --scalar-button-1-hover: rgba(255, 255, 255, 0.85);
  }
`

export const GET = ApiReference({
  url: '/openapi.json',
  pageTitle: 'Shots API Reference',
  favicon: '/favicon.svg',
  metaData: {
    title: 'Shots API Reference',
    description:
      'Interactive REST API documentation for Shots, generated from the public OpenAPI 3.1 contract.',
  },
  theme: 'none',
  customCss: SHOTS_THEME,
  forceDarkModeState: 'dark',
  hideDarkModeToggle: true,
  // Customers see the API, not Scalar's own developer and AI tooling.
  showDeveloperTools: 'never',
  agent: { disabled: true },
  mcp: { disabled: true },
  telemetry: false,
  authentication: { preferredSecurityScheme: 'workspaceApiKey' },
  defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
})
