import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { isInvalidRequest } from '@/lib/api/request'
import { exportRequestSchema, type ExportRequest } from '@/lib/api/schemas'
import { QUALITY_PRESETS } from '@/lib/export/types'

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

export async function POST(request: NextRequest): Promise<NextResponse> {
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
      return NextResponse.json({ error: 'Invalid export request' }, { status: 400 })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process image' },
      { status: 500 }
    )
  }
}
