import type { UserValidateEvent } from '@netlify/functions'

export default {
  userValidate(event: UserValidateEvent) {
    if (event.user.email?.toLowerCase() === 'stoegbauer@players.invalid') return event.deny()
  },
}
