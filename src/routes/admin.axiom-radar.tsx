import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/axiom-radar')({
  beforeLoad: () => { throw redirect({ to: '/axiom-radar' }) },
})
