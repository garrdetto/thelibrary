import { getGameUser } from './game-account.js'

export async function poolIdentity() {
  const user = await getGameUser()
  if (!user) return null
  return { owner: `player:${user.id}`, signedIn: true, username: user.email?.split('@')[0] ?? 'Player' }
}
