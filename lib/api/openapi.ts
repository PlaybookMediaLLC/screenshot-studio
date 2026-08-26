/* eslint-disable max-lines */

import { BASE_URL } from '@/lib/agents/site-content'

const errorResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
})

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Screenshot Studio API',
    version: '1.0.0',
    summary: 'Public HTTP API for Screenshot Studio.',
    description:
      'Screenshot Studio is a free, open-source, browser-based screenshot editor. This API exposes the server-side operations the editor uses: capturing a live web page as an image, recompressing an exported image, resolving a tweet for tweet-to-image rendering, and proxying Twitter media. No API key or account is required; requests are anonymous and shaped by per-IP rate limits. Every error response uses the same JSON envelope with a stable `code` and a human-readable `hint`.',
    contact: {
      name: 'Screenshot Studio',
      url: `${BASE_URL}/contact`,
      email: 'kartik.labhshetwar@gmail.com',
    },
    license: {
      name: 'Apache-2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
    },
    termsOfService: `${BASE_URL}/terms`,
  },
  servers: [{ url: BASE_URL, description: 'Production' }],
  externalDocs: {
    description: 'Interactive Screenshot Studio API reference',
    url: `${BASE_URL}/api-reference`,
  },
  security: [],
  tags: [
    {
      name: 'Screenshots',
      description: 'Capture live web pages as images.',
    },
    { name: 'Images', description: 'Optimize and proxy image bytes.' },
    { name: 'Social', description: 'Resolve social media content.' },
    {
      name: 'Workspace',
      description: 'Authenticated workspace release and source configuration operations.',
    },
    {
      name: 'Assets',
      description: 'Authenticated workspace asset upload and download operations.',
    },
    {
      name: 'Discovery',
      description: 'Machine-readable descriptions of the site and this API.',
    },
  ],
  paths: {
    '/api/screenshot': {
      post: {
        operationId: 'captureScreenshot',
        summary: 'Capture a web page screenshot',
        description:
          'Renders the page at the given URL and returns the screenshot as a base64-encoded PNG. Results are cached per URL, device type, and color scheme; set `forceRefresh` to bypass the cache. Limited to 20 requests per minute per IP address.',
        tags: ['Screenshots'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ScreenshotRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Screenshot captured or served from cache.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScreenshotResponse' },
              },
            },
          },
          '400': errorResponse('The URL or an option value is invalid.'),
          '405': errorResponse('Method not allowed.'),
          '408': errorResponse('The target page took too long to load.'),
          '429': {
            description: 'Per-IP rate limit exceeded.',
            headers: {
              'Retry-After': {
                description: 'Seconds to wait before retrying.',
                schema: { type: 'integer' },
              },
              'X-RateLimit-Limit': {
                description: 'Requests allowed per window.',
                schema: { type: 'integer' },
              },
              'X-RateLimit-Remaining': {
                description: 'Requests remaining in the current window.',
                schema: { type: 'integer' },
              },
              'X-RateLimit-Reset': {
                description: 'Unix epoch milliseconds when the window resets.',
                schema: { type: 'integer' },
              },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RateLimitError' },
              },
            },
          },
          '500': errorResponse('The screenshot could not be produced.'),
          '503': errorResponse('The upstream screenshot service is down.'),
        },
      },
      get: {
        operationId: 'captureScreenshotMethodProbe',
        summary: 'Method probe for the screenshot endpoint',
        description:
          'The screenshot endpoint only accepts POST. GET returns a 405 with the same JSON error envelope and an `Allow` header.',
        tags: ['Screenshots'],
        responses: { '405': errorResponse('Method not allowed.') },
      },
    },
    '/api/export': {
      post: {
        operationId: 'optimizeExportImage',
        summary: 'Recompress an image',
        description:
          'Accepts a raw image as multipart form data and returns an optimized image in the requested format. JPEG uses the MozJPEG encoder, WebP uses libwebp, and PNG uses adaptive filtering. The response body is the image bytes, not JSON.',
        tags: ['Images'],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: { $ref: '#/components/schemas/ExportRequest' },
              encoding: { image: { contentType: 'image/png, image/jpeg, image/webp' } },
            },
          },
        },
        responses: {
          '200': {
            description: 'Optimized image bytes.',
            content: {
              'image/png': { schema: { type: 'string', format: 'binary' } },
              'image/jpeg': { schema: { type: 'string', format: 'binary' } },
              'image/webp': { schema: { type: 'string', format: 'binary' } },
            },
          },
          '400': errorResponse('Missing image, or invalid format/quality preset.'),
          '405': errorResponse('Method not allowed.'),
          '500': errorResponse('The image could not be processed.'),
        },
      },
      get: {
        operationId: 'optimizeExportImageMethodProbe',
        summary: 'Method probe for the export endpoint',
        description:
          'The export endpoint only accepts POST. GET returns a 405 with the same JSON error envelope and an `Allow` header.',
        tags: ['Images'],
        responses: { '405': errorResponse('Method not allowed.') },
      },
    },
    '/api/tweet/{id}': {
      get: {
        operationId: 'getTweet',
        summary: 'Fetch a tweet by ID',
        description:
          'Returns the public tweet payload used to render a tweet as an image. The `id` is the numeric status ID from the tweet URL.',
        tags: ['Social'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Numeric tweet status ID, for example 1234567890123456789.',
            schema: { type: 'string', pattern: '^[0-9]+$' },
          },
        ],
        responses: {
          '200': {
            description: 'Tweet payload.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TweetResponse' },
              },
            },
          },
          '404': errorResponse('No tweet exists with that ID.'),
          '500': errorResponse('The tweet could not be fetched.'),
        },
      },
    },
    '/api/image-proxy': {
      get: {
        operationId: 'proxyTwitterImage',
        summary: 'Proxy a Twitter media file',
        description:
          'Streams a Twitter-hosted image through this origin so it can be drawn onto a canvas without tainting it. Only pbs.twimg.com, abs.twimg.com, ton.twitter.com, and video.twimg.com are allowed.',
        tags: ['Images'],
        parameters: [
          {
            name: 'url',
            in: 'query',
            required: true,
            description: 'Absolute URL of the Twitter-hosted media file.',
            schema: { type: 'string', format: 'uri' },
          },
        ],
        responses: {
          '200': {
            description: 'Image bytes.',
            content: {
              'image/*': { schema: { type: 'string', format: 'binary' } },
            },
          },
          '400': errorResponse('The `url` query parameter is missing.'),
          '403': errorResponse('The host is not on the allowlist.'),
          '502': errorResponse('The upstream host refused the request.'),
          '500': errorResponse('The image could not be fetched.'),
        },
      },
    },
    '/api/v1/releases': {
      get: {
        operationId: 'listReleases',
        summary: 'List workspace releases',
        description: 'Lists releases in the API key workspace. Requires the `artifact:read` scope.',
        tags: ['Workspace'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: 'query',
            name: 'limit',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        ],
        responses: {
          '200': {
            description: 'Workspace releases.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ReleaseListResponse' } },
            },
          },
          '400': errorResponse('The list query is invalid.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The API key lacks the required workspace scope.'),
          '503': errorResponse('A required dependency is unavailable.'),
        },
      },
      post: {
        operationId: 'createRelease',
        summary: 'Create a workspace release',
        description:
          'Creates a release in the API key workspace. Accepts `Idempotency-Key` and requires the `release:create` scope.',
        tags: ['Workspace'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: 'header',
            name: 'Idempotency-Key',
            schema: { type: 'string', maxLength: 128 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ReleaseCreateRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'An existing idempotent result.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '201': {
            description: 'Release created.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '400': errorResponse('The release input is invalid.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The API key lacks the required workspace scope.'),
          '503': errorResponse('A required dependency is unavailable.'),
        },
      },
    },
    '/api/v1/source-apps': {
      post: {
        operationId: 'createSourceApp',
        summary: 'Create a workspace source app',
        description:
          'Registers a release-intake source in the API key workspace. Requires the `source:write` scope.',
        tags: ['Workspace'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SourceAppCreateRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'Source app created.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '400': errorResponse('The source app input is invalid.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The API key lacks the required workspace scope.'),
          '503': errorResponse('A required dependency is unavailable.'),
        },
      },
    },
    '/api/v1/assets/upload-url': {
      post: {
        operationId: 'createAssetUploadUrl',
        summary: 'Create a signed asset upload URL',
        description:
          'Creates an asset record and a short-lived signed upload URL. Requires the `upload:sign` scope.',
        tags: ['Assets'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/AssetUploadRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'Signed upload instructions.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '400': errorResponse('The asset metadata is invalid.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The API key lacks the required workspace scope.'),
          '503': errorResponse('A required dependency is unavailable.'),
        },
      },
    },
    '/api/v1/assets/{assetId}/complete': {
      post: {
        operationId: 'completeAssetUpload',
        summary: 'Complete an asset upload',
        description:
          'Marks a signed upload as complete after storage verification. Requires the `asset:write` scope.',
        tags: ['Assets'],
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/AssetId' }],
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/AssetCompleteRequest' } },
          },
        },
        responses: {
          '200': { description: 'Asset upload completed.' },
          '400': errorResponse('The completion input is invalid.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The API key lacks the required workspace scope.'),
          '404': errorResponse('The asset was not found in this workspace.'),
          '503': errorResponse('A required dependency is unavailable.'),
        },
      },
    },
    '/api/v1/assets/{assetId}/download-url': {
      get: {
        operationId: 'createAssetDownloadUrl',
        summary: 'Create a signed asset download URL',
        description:
          'Returns a short-lived signed download URL for a workspace asset. Requires the `artifact:read` scope.',
        tags: ['Assets'],
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/AssetId' }],
        responses: {
          '200': {
            description: 'Signed asset download URL.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AssetDownloadResponse' },
              },
            },
          },
          '400': errorResponse('The asset identifier is invalid.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The API key lacks the required workspace scope.'),
          '404': errorResponse('The asset was not found in this workspace.'),
          '503': errorResponse('A required dependency is unavailable.'),
        },
      },
    },
    '/api/v1/assets/{assetId}': {
      delete: {
        operationId: 'deleteAsset',
        summary: 'Delete a workspace asset',
        description:
          'Queues deletion of an uploaded asset that is not in use. Requires the `asset:write` scope and the asset deletion workspace entitlement (Pro or higher by default).',
        tags: ['Assets'],
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/AssetId' }],
        responses: {
          '202': { description: 'Asset deletion accepted.' },
          '400': errorResponse('The asset identifier is invalid.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse(
            'The principal lacks the required workspace permission, scope, or pricing entitlement.'
          ),
          '404': errorResponse('The asset was not found in this workspace.'),
          '409': errorResponse('The asset is in use or is not ready for deletion.'),
          '503': errorResponse('A required dependency is unavailable.'),
        },
      },
    },
    '/openapi.json': {
      get: {
        operationId: 'getOpenApiSpec',
        summary: 'Fetch this OpenAPI specification',
        description:
          'Returns the OpenAPI 3.1 document describing every public Screenshot Studio operation.',
        tags: ['Discovery'],
        responses: {
          '200': {
            description: 'OpenAPI 3.1 document.',
            content: {
              'application/json': { schema: { type: 'object' } },
            },
          },
        },
      },
    },
    '/llms.txt': {
      get: {
        operationId: 'getLlmsTxt',
        summary: 'Fetch the llms.txt site overview',
        description:
          'Returns a Markdown overview of Screenshot Studio: features, pages, pricing, and contact details.',
        tags: ['Discovery'],
        responses: {
          '200': {
            description: 'Markdown overview.',
            content: {
              'text/markdown': { schema: { type: 'string' } },
            },
          },
        },
      },
    },
    '/llms-full.txt': {
      get: {
        operationId: 'getLlmsFullTxt',
        summary: 'Fetch the full llms.txt reference',
        description:
          'Returns the complete Markdown reference: every feature, every page, the technology stack, and the privacy model.',
        tags: ['Discovery'],
        responses: {
          '200': {
            description: 'Markdown reference.',
            content: {
              'text/markdown': { schema: { type: 'string' } },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Workspace API key with the operation-required scope.',
      },
    },
    parameters: {
      AssetId: {
        in: 'path',
        name: 'assetId',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
    },
    schemas: {
      ReleaseCreateRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'benefitStatement'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 160 },
          benefitStatement: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
      ReleaseListResponse: {
        type: 'object',
        required: ['releases'],
        properties: { releases: { type: 'array', items: { type: 'object' } } },
      },
      SourceAppCreateRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['allowedHosts', 'name'],
        properties: {
          allowedHosts: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: { type: 'string', format: 'uri' },
          },
          externalId: { type: 'string', maxLength: 160 },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          provider: { type: 'string', default: 'generic', maxLength: 64 },
          secretReference: { type: 'string', maxLength: 128 },
        },
      },
      AssetUploadRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['bytes', 'contentType', 'fileName'],
        properties: {
          bytes: { type: 'integer', minimum: 1, maximum: 52428800 },
          classification: { type: 'string', default: 'input' },
          contentType: {
            type: 'string',
            enum: ['image/gif', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'],
          },
          fileName: { type: 'string', minLength: 1, maxLength: 128 },
          sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
        },
      },
      AssetCompleteRequest: {
        type: 'object',
        additionalProperties: false,
        properties: { sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } },
      },
      AssetDownloadResponse: {
        type: 'object',
        required: ['downloadUrl'],
        properties: { downloadUrl: { type: 'string', format: 'uri' } },
      },
      Error: {
        type: 'object',
        description:
          'Every failing request returns this envelope. `code` is stable and safe to branch on; `error` and `message` carry the same human-readable text.',
        required: ['error', 'code', 'message', 'hint', 'status', 'documentation'],
        properties: {
          error: {
            type: 'string',
            description: 'Human-readable error message.',
            examples: ['URL is required'],
          },
          code: {
            type: 'string',
            description: 'Stable machine-readable error code.',
            enum: [
              'invalid_request',
              'invalid_url',
              'unsupported_value',
              'unauthorized',
              'forbidden_domain',
              'not_found',
              'method_not_allowed',
              'rate_limited',
              'upstream_timeout',
              'upstream_unavailable',
              'upstream_failed',
              'internal_error',
            ],
          },
          message: {
            type: 'string',
            description: 'Human-readable error message, same value as `error`.',
          },
          hint: {
            type: 'string',
            description: 'How to resolve the error.',
          },
          status: {
            type: 'integer',
            description: 'HTTP status code, repeated in the body.',
          },
          documentation: {
            type: 'string',
            format: 'uri',
            description: 'Link to the error reference.',
          },
        },
      },
      RateLimitError: {
        allOf: [
          { $ref: '#/components/schemas/Error' },
          {
            type: 'object',
            properties: {
              retryAfter: {
                type: 'integer',
                description: 'Seconds to wait before retrying.',
              },
            },
          },
        ],
      },
      ScreenshotRequest: {
        type: 'object',
        required: ['url'],
        properties: {
          url: {
            type: 'string',
            format: 'uri',
            description: 'Absolute http or https URL of the page to capture.',
            examples: ['https://example.com'],
          },
          deviceType: {
            type: 'string',
            enum: ['desktop', 'mobile'],
            default: 'desktop',
            description: 'Viewport preset. `desktop` is 1920x1080, `mobile` is 375x667.',
          },
          colorScheme: {
            type: 'string',
            enum: ['light', 'dark'],
            default: 'light',
            description: 'prefers-color-scheme sent to the target page.',
          },
          forceRefresh: {
            type: 'boolean',
            default: false,
            description: 'Bypass and replace the cached capture for this URL.',
          },
        },
      },
      ScreenshotResponse: {
        type: 'object',
        required: ['screenshot', 'url', 'cached'],
        properties: {
          screenshot: {
            type: 'string',
            contentEncoding: 'base64',
            description: 'Base64-encoded PNG bytes, without a data URI prefix.',
          },
          url: {
            type: 'string',
            format: 'uri',
            description: 'Normalized URL that was captured.',
          },
          cached: {
            type: 'boolean',
            description: 'True when the image was served from cache.',
          },
          strategy: {
            type: 'string',
            description: 'Capture backend that produced the image.',
          },
          deviceType: { type: 'string', enum: ['desktop', 'mobile'] },
          colorScheme: { type: 'string', enum: ['light', 'dark'] },
        },
      },
      ExportRequest: {
        type: 'object',
        required: ['image', 'format', 'qualityPreset'],
        properties: {
          image: {
            type: 'string',
            format: 'binary',
            description: 'The raw image file to recompress.',
          },
          format: {
            type: 'string',
            enum: ['png', 'jpeg', 'webp'],
            description: 'Output image format.',
          },
          qualityPreset: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'Compression preset applied to the chosen format.',
          },
        },
      },
      TweetResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: ['object', 'null'],
            description:
              'Tweet payload as returned by the public syndication API, or null when the tweet is unavailable.',
          },
          error: {
            type: 'string',
            description: 'Present only when `data` is null.',
          },
        },
      },
    },
  },
} as const
