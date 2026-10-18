# Shots API client

A typed TypeScript client for the Shots REST API. `src/schema.ts` is generated
from the production OpenAPI document (`/openapi.json`) by `openapi-typescript`;
requests go through `openapi-fetch`.

```ts
import { createShotsClient } from 'shots-api-client'

const shots = createShotsClient({ apiKey: process.env.SHOTS_API_KEY! })

const { data, error } = await shots.POST('/api/v1/campaigns', {
  body: {
    name: 'Recurring invoices',
    objective: 'Announce recurring invoices',
    posts: [{ channel: 'linkedin', copy: 'Recurring invoices are here.' }],
  },
  headers: { 'Idempotency-Key': 'recurring-invoices-launch' },
})
```

## Regenerating

Never edit `src/schema.ts` by hand. From the repository root:

```sh
npm run api:generate
```

That writes the OpenAPI document to `services/internal/shotsapi/openapi.json`
and regenerates `src/schema.ts` from it. CI runs the same command and fails
when either file is out of date, and it fails a pull request that makes an
unintended breaking change to the document (see RFC 034).

The package is `private` until the npm trusted publisher for it is configured;
`npm run build` in this directory produces `dist`.
