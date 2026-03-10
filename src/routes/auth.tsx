import { createFileRoute, redirect } from '@tanstack/react-router'
import { auth } from '../lib/auth'

export const Route = createFileRoute('/auth')({
  beforeLoad: async () => {
    const session = await auth.api.getSession({
      headers: new Headers(),
    })
    
    // If already authenticated, redirect to dashboard
    if (session?.user) {
      throw redirect({ to: '/dashboard' })
    }
  },
})
