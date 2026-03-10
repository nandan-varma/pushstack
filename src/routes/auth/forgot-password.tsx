import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'

export const Route = createFileRoute('/auth/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // TODO: Implement password reset when email service is configured
      // await authClient.forgetPassword({ email })
      
      // For now, show a message that this feature requires email configuration
      setError('Password reset requires email service configuration. Please contact support.')
      setLoading(false)
      
      // When implemented, uncomment:
      // setSuccess(true)
    } catch (err) {
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--card-bg)] p-8 shadow-2xl backdrop-blur-lg">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-[var(--sea-ink)]">
            Check your email
          </h1>
          <p className="mt-4 text-sm text-[var(--sea-ink-soft)]">
            If an account exists with {email}, you'll receive password reset instructions.
          </p>
        </div>
        
        <Button
          onClick={() => navigate({ to: '/auth/login' })}
          className="w-full"
        >
          Back to Sign In
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--card-bg)] p-8 shadow-2xl backdrop-blur-lg">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-[var(--sea-ink)]">
          Reset password
        </h1>
        <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
          Enter your email to receive reset instructions
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-200">
            {error}
          </div>
        )}

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

        <Button
          type="submit"
          className="w-full"
          disabled={loading}
        >
          {loading ? 'Sending...' : 'Send Reset Link'}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-sm text-[var(--sea-ink-soft)]">
          Remember your password?{' '}
          <a
            href="/auth/login"
            className="font-medium text-[var(--lagoon-deep)] hover:underline"
          >
            Sign in →
          </a>
        </p>
      </div>
    </div>
  )
}
