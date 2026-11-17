import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/gspro')({
  beforeLoad: () => { throw redirect({ to: '/gspro' }) },
})
