import type { User } from '@netlify/identity'
import { getGameUser } from './game-account.js'

export const studioPages = ['chat', 'image', 'lyrics'] as const
export function usernameOf(user: User) {
  return user.email?.split('@')[0] ?? 'Player'
}
export function isWorkspaceAdmin(user: User) {
  return user.email?.toLowerCase() === 'stoegbauer@players.invalid'
}
export function permissionsOf(user: User | null): string[] {
  if (!user) return []
  if (isWorkspaceAdmin(user)) return [...studioPages]
  const permissions = user.appMetadata?.workspace_pages
  return Array.isArray(permissions) ? studioPages.filter(page => permissions.includes(page)) : []
}
export async function workspaceAccess() {
  const user = await getGameUser()
  return { username: user ? usernameOf(user) : null, isAdmin: user ? isWorkspaceAdmin(user) : false, pages: permissionsOf(user) }
}
