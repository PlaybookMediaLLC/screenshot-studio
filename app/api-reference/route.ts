import { ApiReference } from '@scalar/nextjs-api-reference'

export const dynamic = 'force-static'

export const GET = ApiReference({
  url: '/openapi.json',
  pageTitle: 'Shots API Reference',
  metaData: {
    title: 'Shots API Reference',
    description:
      'Interactive REST API documentation for Shots, generated from the public OpenAPI 3.1 contract.',
  },
})
