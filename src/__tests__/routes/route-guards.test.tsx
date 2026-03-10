import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { createRoute, redirect } from '@tanstack/react-router'
import { renderWithRouter, rootRoute } from '../../test/router-utils'

describe('Route Guards and Protection', () => {
  it('should redirect unauthenticated users', async () => {
    const mockAuth = { isAuthenticated: false, user: null }

    function ProtectedPage() {
      return (
        <div data-testid="protected-content">
          <h1>Protected Content</h1>
          <p>You should not see this</p>
        </div>
      )
    }

    function LoginPage() {
      return (
        <div data-testid="login-page">
          <h1>Login Required</h1>
          <p>Please log in to continue</p>
        </div>
      )
    }

    const protectedRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/protected',
      component: ProtectedPage,
      beforeLoad: () => {
        if (!mockAuth.isAuthenticated) {
          throw redirect({ to: '/login' })
        }
      },
    })

    const loginRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/login',
      component: LoginPage,
    })

    renderWithRouter(<div />, {
      routes: [protectedRoute, loginRoute],
      initialLocation: '/protected',
    })

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })

    expect(screen.getByText('Login Required')).toBeInTheDocument()
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
  })

  it('should allow authenticated users to access protected routes', async () => {
    const mockAuth = { isAuthenticated: true, user: { id: '1', name: 'Test User' } }

    function ProtectedPage() {
      return (
        <div data-testid="protected-content">
          <h1>Protected Content</h1>
          <p>Welcome, authenticated user!</p>
        </div>
      )
    }

    function LoginPage() {
      return <h1>Login Page</h1>
    }

    const protectedRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/protected',
      component: ProtectedPage,
      beforeLoad: () => {
        if (!mockAuth.isAuthenticated) {
          throw redirect({ to: '/login' })
        }
      },
    })

    const loginRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/login',
      component: LoginPage,
    })

    renderWithRouter(<div />, {
      routes: [protectedRoute, loginRoute],
      initialLocation: '/protected',
    })

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument()
    })

    expect(screen.getByText('Protected Content')).toBeInTheDocument()
    expect(screen.getByText('Welcome, authenticated user!')).toBeInTheDocument()
  })

  it('should handle role-based access control', async () => {
    const mockAuth = {
      isAuthenticated: true,
      user: { id: '1', name: 'Test User', role: 'user' },
    }

    function AdminPage() {
      return <h1>Admin Dashboard</h1>
    }

    function UnauthorizedPage() {
      return (
        <div data-testid="unauthorized">
          <h1>Unauthorized</h1>
          <p>You don't have permission to access this page</p>
        </div>
      )
    }

    const adminRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/admin',
      component: AdminPage,
      beforeLoad: () => {
        if (!mockAuth.isAuthenticated || mockAuth.user.role !== 'admin') {
          throw redirect({ to: '/unauthorized' })
        }
      },
    })

    const unauthorizedRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/unauthorized',
      component: UnauthorizedPage,
    })

    renderWithRouter(null, {
      routes: [adminRoute, unauthorizedRoute],
      initialLocation: '/admin',
    })

    await waitFor(() => {
      expect(screen.getByTestId('unauthorized')).toBeInTheDocument()
    })

    expect(screen.getByText('Unauthorized')).toBeInTheDocument()
  })

  it('should redirect with return URL', async () => {
    const mockAuth = { isAuthenticated: false }

    function DashboardPage() {
      return <h1>Dashboard</h1>
    }

    let capturedSearch: any = null

    function LoginPage() {
      const search = (window as any).routeSearch
      capturedSearch = search
      return (
        <div data-testid="login-page">
          <h1>Login</h1>
          {search?.redirect && (
            <p data-testid="redirect-notice">After login, you'll be redirected</p>
          )}
        </div>
      )
    }

    const dashboardRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/dashboard',
      component: DashboardPage,
      beforeLoad: ({ location }) => {
        if (!mockAuth.isAuthenticated) {
          throw redirect({
            to: '/login',
            search: { redirect: location.href },
          })
        }
      },
    })

    const loginRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/login',
      component: LoginPage,
      validateSearch: (search) => {
        const validated = {
          redirect: (search.redirect as string) || '',
        }
        ;(window as any).routeSearch = validated
        return validated
      },
    })

    renderWithRouter(null, {
      routes: [dashboardRoute, loginRoute],
      initialLocation: '/dashboard',
    })

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })

    expect(screen.getByTestId('redirect-notice')).toBeInTheDocument()
    expect(capturedSearch?.redirect).toBeTruthy()

    // Cleanup
    delete (window as any).routeSearch
  })

  it('should validate permissions before loading data', async () => {
    const mockAuth = {
      isAuthenticated: true,
      user: { id: '1', permissions: ['read'] },
    }

    let loaderCalled = false

    function EditPage() {
      return <h1>Edit Page</h1>
    }

    function ForbiddenPage() {
      return (
        <div data-testid="forbidden">
          <h1>Forbidden</h1>
          <p>You don't have permission to edit</p>
        </div>
      )
    }

    const editRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/edit/$id',
      component: EditPage,
      beforeLoad: () => {
        if (!mockAuth.user.permissions.includes('write')) {
          throw redirect({ to: '/forbidden' })
        }
      },
      loader: async () => {
        loaderCalled = true
        return { data: 'test' }
      },
    })

    const forbiddenRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/forbidden',
      component: ForbiddenPage,
    })

    renderWithRouter(null, {
      routes: [editRoute, forbiddenRoute],
      initialLocation: '/edit/123',
    })

    await waitFor(() => {
      expect(screen.getByTestId('forbidden')).toBeInTheDocument()
    })

    expect(screen.getByText('Forbidden')).toBeInTheDocument()
    expect(loaderCalled).toBe(false) // Loader should not run if beforeLoad redirects
  })
})
