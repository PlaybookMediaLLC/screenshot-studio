import { ApiReference } from '@scalar/nextjs-api-reference'

export const dynamic = 'force-static'

export const GET = ApiReference({
  url: '/openapi.json',
  pageTitle: 'Screenshot Studio API Reference',
  metaData: {
    title: 'Screenshot Studio API Reference',
    description:
      'Interactive REST API documentation for Screenshot Studio, generated from the public OpenAPI 3.1 contract.',
  },
})
