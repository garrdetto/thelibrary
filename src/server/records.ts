import { safeEqual, sha256 } from './auth'

const recordResetHash = '36a0db56e15514db96e87fba4b7b83b81c7e2db62df6a0e7b7d90cc25d4b994f'

export async function isRecordResetPassword(password: string) {
  return safeEqual(await sha256(password), recordResetHash)
}
