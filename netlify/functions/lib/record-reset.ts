import { createHash, timingSafeEqual } from 'node:crypto'

const expectedHash = Buffer.from('36a0db56e15514db96e87fba4b7b83b81c7e2db62df6a0e7b7d90cc25d4b994f', 'hex')

export function isRecordResetPassword(password: string) {
  return timingSafeEqual(createHash('sha256').update(password).digest(), expectedHash)
}
