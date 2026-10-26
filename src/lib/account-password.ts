export function identityPassword(password: string) {
  return password.length < 8 ? `myWorkHelper:${password}` : password
}
