import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '../lib/auth'

const getAuthSession = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = getRequestHeaders()
  return await auth.api.getSession({ headers })
})

export const Route = createFileRoute('/auth')({
  component: AuthLayout,
  beforeLoad: async () => {
    const session = await getAuthSession()
    
    // If already authenticated, redirect to dashboard
    if (session?.user) {
      throw redirect({ to: '/dashboard' })
    }
  },
})

function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[var(--gradient-1)] via-[var(--gradient-2)] to-[var(--gradient-3)] p-4">
      <Outlet />
    </div>
  )
}
