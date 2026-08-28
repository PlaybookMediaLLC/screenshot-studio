import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { isInvalidRequest } from '@/lib/api/request'
import { exportRequestSchema, type ExportRequest } from '@/lib/api/schemas'
import { QUALITY_PRESETS } from '@/lib/export/types'
import { apiError, methodNotAllowed } from '@/lib/api/errors'

type ExportResult = {
  buffer: Buffer
  mimeType: string
}

function getMimeType(format: ExportRequest['format']): string {
  if (format === 'jpeg') {
    return 'image/jpeg'
  }

  return `image/${format}`
}

async function encodeImage(input: ExportRequest, buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer)
  const quality = QUALITY_PRESETS[input.qualityPreset]

  if (input.format === 'jpeg') {
    return image
      .flatten({ background: { b: 255, g: 255, r: 255 } })
      .jpeg({
        mozjpeg: true,
        quality: quality.jpeg,
      })
      .toBuffer()
  }
  if (input.format === 'webp') {
    return image.webp({ effort: 4, quality: quality.webp }).toBuffer()
  }

  return image.png({ adaptiveFiltering: true, compressionLevel: quality.pngCompression }).toBuffer()
}

async function exportImage(input: ExportRequest): Promise<ExportResult> {
  const source = Buffer.from(await input.image.arrayBuffer())
  const buffer = await encodeImage(input, source)
  return { buffer, mimeType: getMimeType(input.format) }
}

function invalidContentTypeResponse(request: NextRequest): NextResponse | null {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (
    contentType === 'multipart/form-data' ||
    contentType === 'application/x-www-form-urlencoded'
  ) {
    return null
  }

  return apiError(
    400,
    'invalid_request',
    'Invalid export request',
    'Send multipart/form-data with image, format, and qualityPreset fields.'
  )
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentTypeResponse = invalidContentTypeResponse(request)
  if (contentTypeResponse) return contentTypeResponse

  try {
    const formData = await request.formData()
    const input = exportRequestSchema.parse({
      format: formData.get('format'),
      image: formData.get('image'),
      qualityPreset: formData.get('qualityPreset'),
    })
    const result = await exportImage(input)
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        'Content-Length': result.buffer.length.toString(),
        'Content-Type': result.mimeType,
      },
    })
  } catch (error) {
    console.error('Export API error:', error)
    if (isInvalidRequest(error)) {
      return apiError(
        400,
        'invalid_request',
        'Invalid export request',
        'Send multipart/form-data with image, format, and qualityPreset fields.'
      )
    }

    return apiError(
      500,
      'internal_error',
      error instanceof Error ? error.message : 'Failed to process image',
      'Check that the uploaded file is a decodable PNG, JPEG, or WebP image, then retry.'
    )
  }
}

export async function GET() {
  return methodNotAllowed(['POST'])
}
