import { createFileRoute, redirect } from '@tanstack/react-router'
import { auth } from '../lib/auth'

export const Route = createFileRoute('/repositories')({
  beforeLoad: async () => {
    const session = await auth.api.getSession({
      headers: new Headers(),
    })
    
    if (!session?.user) {
      throw redirect({ to: '/auth/login' })
    }
    
    return { user: session.user }
  },
})
