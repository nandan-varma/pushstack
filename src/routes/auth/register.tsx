import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '../../lib/auth-client'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'

export const Route = createFileRoute('/auth/register')({
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)

    try {
      const result = await authClient.signUp.email({
        email,
        password,
        name,
      })

      if (result.error) {
        setError(result.error.message || 'Registration failed')
        setLoading(false)
        return
      }

      // Redirect to dashboard on success
      navigate({ to: '/dashboard' })
    } catch (err) {
      setError('An error occurred during registration')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[var(--gradient-1)] via-[var(--gradient-2)] to-[var(--gradient-3)] p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--card-bg)] p-8 shadow-2xl backdrop-blur-lg">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-[var(--sea-ink)]">
            Join <span className="text-[var(--lagoon-deep)]">PushStack</span>
          </h1>
          <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
            Create your account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-200">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
            />
            <p className="text-xs text-[var(--sea-ink-soft)]">
              Must be at least 8 characters
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-[var(--sea-ink-soft)]">
            Already have an account?{' '}
            <a
              href="/auth/login"
              className="font-medium text-[var(--lagoon-deep)] hover:underline"
            >
              Sign in →
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
