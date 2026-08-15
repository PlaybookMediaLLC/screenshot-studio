import { createHmac } from 'node:crypto'

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function decodeBase32(value: string): Buffer {
  let bits = 0
  let buffer = 0
  const bytes: number[] = []

  for (const character of value.replace(/=+$/, '').toUpperCase()) {
    const index = base32Alphabet.indexOf(character)
    if (index < 0) {
      throw new Error('The TOTP secret is not base32 encoded.')
    }

    buffer = (buffer << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

export function getTotpCode(uri: string, now = Date.now()): string {
  const parsed = new URL(uri)
  const secret = parsed.searchParams.get('secret')
  if (!secret) {
    throw new Error('The TOTP URI has no secret.')
  }

  const period = Number(parsed.searchParams.get('period') ?? '30')
  const digits = Number(parsed.searchParams.get('digits') ?? '6')
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest()
  const offset = digest.at(-1)! & 0x0f
  const value =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!
  return (value % 10 ** digits).toString().padStart(digits, '0')
}
