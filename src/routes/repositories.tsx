import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '../lib/auth'

const getAuthSession = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = getRequestHeaders()
  return await auth.api.getSession({ headers })
})

export const Route = createFileRoute('/repositories')({
  beforeLoad: async () => {
    const session = await getAuthSession()
    
    if (!session?.user) {
      throw redirect({ to: '/auth/login' })
    }
    
    return { user: session.user }
  },
})
