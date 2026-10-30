import { ArrowRight, LogIn } from 'lucide-react'

function focusSignIn() {
  const field = document.querySelector<HTMLInputElement>('.pool-account input[name="username"]')
  if (!field) return
  field.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  field.focus({ preventScroll: true })
}

export function SignInRibbon() {
  return <div className="signin-ribbon" role="status">
    <LogIn size={16} aria-hidden="true"/>
    <p>Sign in/Register to play, any username and password will work to save your progress.</p>
    <button type="button" onClick={focusSignIn}>Sign in <ArrowRight size={14}/></button>
  </div>
}
