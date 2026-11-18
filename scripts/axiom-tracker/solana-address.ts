import { createHash } from 'node:crypto'

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const fieldPrime = 2n ** 255n - 19n
const curveD = (-121665n * inverse(121666n)) % fieldPrime

export const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const token2022Program = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
export const associatedTokenProgram = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

export function decodeBase58(text: string): Uint8Array {
  let value = 0n
  for (const character of text) {
    const digit = alphabet.indexOf(character)
    if (digit < 0) throw new Error('Not a base58 address')
    value = value * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (value > 0n) {
    bytes.unshift(Number(value % 256n))
    value /= 256n
  }
  for (const character of text) {
    if (character !== '1') break
    bytes.unshift(0)
  }
  return Uint8Array.from(bytes)
}

export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n
  for (const byte of bytes) value = value * 256n + BigInt(byte)
  let text = ''
  while (value > 0n) {
    text = alphabet[Number(value % 58n)] + text
    value /= 58n
  }
  for (const byte of bytes) {
    if (byte !== 0) break
    text = '1' + text
  }
  return text
}

function power(base: bigint, exponent: bigint): bigint {
  let result = 1n
  let factor = ((base % fieldPrime) + fieldPrime) % fieldPrime
  let rest = exponent
  while (rest > 0n) {
    if (rest & 1n) result = (result * factor) % fieldPrime
    factor = (factor * factor) % fieldPrime
    rest >>= 1n
  }
  return result
}

function inverse(value: bigint): bigint {
  return power(value, fieldPrime - 2n)
}

/** True when 32 bytes decode to a point on the ed25519 curve, which a program address must never be. */
export function onCurve(bytes: Uint8Array): boolean {
  let y = 0n
  for (let index = 31; index >= 0; index--) y = (y << 8n) | BigInt(index === 31 ? bytes[index] & 0x7f : bytes[index])
  if (y >= fieldPrime) return false
  const ySquared = (y * y) % fieldPrime
  const top = (ySquared - 1n + fieldPrime) % fieldPrime
  const bottom = (curveD * ySquared + 1n) % fieldPrime
  const xSquared = (top * inverse(bottom)) % fieldPrime
  if (xSquared === 0n) return true
  return power(xSquared, (fieldPrime - 1n) / 2n) === 1n
}

/** Solana's findProgramAddress: the first bump from 255 down whose hash is off the curve. */
export function programAddress(seeds: Uint8Array[], program: string): string {
  const programBytes = decodeBase58(program)
  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash('sha256')
    for (const seed of seeds) hash.update(seed)
    hash.update(Uint8Array.of(bump)).update(programBytes).update('ProgramDerivedAddress')
    const digest = new Uint8Array(hash.digest())
    if (!onCurve(digest)) return encodeBase58(digest)
  }
  throw new Error('No program address found')
}

/** The wallet's associated token account for a mint under the given token program. */
export function associatedTokenAccount(wallet: string, mint: string, program = tokenProgram): string {
  return programAddress([decodeBase58(wallet), decodeBase58(program), decodeBase58(mint)], associatedTokenProgram)
}
