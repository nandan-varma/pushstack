import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { createRoute } from '@tanstack/react-router'
import { renderWithRouter, rootRoute, createTestQueryClient } from '../../test/router-utils'
import { mockUser, mockRepository } from '../../test/mock-routes'

describe('Route Data Loading', () => {
  it('should load and display data from loader', async () => {
    const mockFetchUser = vi.fn().mockResolvedValue(mockUser)

    let loaderData: any = null

    function UserProfile() {
      const data = (window as any).loaderData
      loaderData = data
      return (
        <div data-testid="user-profile">
          <h1 data-testid="user-name">{data?.name}</h1>
          <p data-testid="user-email">{data?.email}</p>
        </div>
      )
    }

    const userRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/users/$userId',
      component: UserProfile,
      loader: async ({ params }) => {
        const data = await mockFetchUser(params.userId)
        ;(window as any).loaderData = data
        return data
      },
    })

    renderWithRouter(<div />, {
      routes: [userRoute],
      initialLocation: '/users/1',
    })

    await waitFor(() => {
      expect(screen.getByTestId('user-profile')).toBeInTheDocument()
    })

    expect(screen.getByTestId('user-name')).toHaveTextContent('Test User')
    expect(screen.getByTestId('user-email')).toHaveTextContent('test@example.com')
    expect(mockFetchUser).toHaveBeenCalledWith('1')
    expect(loaderData).toEqual(mockUser)

    // Cleanup
    delete (window as any).loaderData
  })

  it('should handle loader errors with error component', async () => {
    const mockFetchUser = vi.fn().mockRejectedValue(new Error('User not found'))

    function UserProfile() {
      const data = (window as any).loaderData
      return <div>{data?.name}</div>
    }

    function ErrorComponent({ error }: { error: Error }) {
      return (
        <div data-testid="error">
          <h1>Error Occurred</h1>
          <p data-testid="error-message">{error.message}</p>
        </div>
      )
    }

    const userRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/users/$userId',
      component: UserProfile,
      loader: async ({ params }) => {
        const data = await mockFetchUser(params.userId)
        ;(window as any).loaderData = data
        return data
      },
      errorComponent: ErrorComponent as any,
    })

    renderWithRouter(<div />, {
      routes: [userRoute],
      initialLocation: '/users/1',
    })

    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeInTheDocument()
    })

    expect(screen.getByText('Error Occurred')).toBeInTheDocument()
    expect(screen.getByTestId('error-message')).toHaveTextContent('User not found')
  })

  it('should show pending component while loading', async () => {
    const mockFetchRepo = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(mockRepository), 100)
        }),
    )

    function RepoView() {
      const data = (window as any).loaderData
      return (
        <div data-testid="repo-view">
          <h1>{data?.name}</h1>
        </div>
      )
    }

    function PendingComponent() {
      return <div data-testid="loading">Loading repository...</div>
    }

    const repoRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/repo/$owner/$name',
      component: RepoView,
      loader: async ({ params }) => {
        const data = await mockFetchRepo(params.owner, params.name)
        ;(window as any).loaderData = data
        return data
      },
      pendingComponent: PendingComponent,
    })

    renderWithRouter(null, {
      routes: [repoRoute],
      initialLocation: '/repo/testuser/testrepo',
    })

    // Should show loading state initially
    expect(screen.getByTestId('loading')).toBeInTheDocument()

    // Wait for data to load
    await waitFor(
      () => {
        expect(screen.getByTestId('repo-view')).toBeInTheDocument()
      },
      { timeout: 2000 },
    )

    expect(screen.getByText('test-repo')).toBeInTheDocument()
    expect(mockFetchRepo).toHaveBeenCalledWith('testuser', 'testrepo')

    // Cleanup
    delete (window as any).loaderData
  })

  it('should load data with dependencies', async () => {
    const mockFetchRepo = vi.fn().mockResolvedValue(mockRepository)
    const mockFetchIssues = vi.fn().mockResolvedValue([
      { id: 1, title: 'Issue 1' },
      { id: 2, title: 'Issue 2' },
    ])

    let loaderData: any = null

    function RepoIssues() {
      const data = (window as any).loaderData
      loaderData = data
      return (
        <div data-testid="repo-issues">
          <h1>{data?.repo.name}</h1>
          <ul data-testid="issues-list">
            {data?.issues.map((issue: any) => (
              <li key={issue.id}>{issue.title}</li>
            ))}
          </ul>
        </div>
      )
    }

    const repoIssuesRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/repo/$owner/$name/issues',
      component: RepoIssues,
      loader: async ({ params }) => {
        const repo = await mockFetchRepo(params.owner, params.name)
        const issues = await mockFetchIssues(repo.id)
        const data = { repo, issues }
        ;(window as any).loaderData = data
        return data
      },
    })

    renderWithRouter(null, {
      routes: [repoIssuesRoute],
      initialLocation: '/repo/testuser/testrepo/issues',
    })

    await waitFor(() => {
      expect(screen.getByTestId('repo-issues')).toBeInTheDocument()
    })

    expect(screen.getByText('test-repo')).toBeInTheDocument()
    expect(screen.getByText('Issue 1')).toBeInTheDocument()
    expect(screen.getByText('Issue 2')).toBeInTheDocument()

    expect(mockFetchRepo).toHaveBeenCalledWith('testuser', 'testrepo')
    expect(mockFetchIssues).toHaveBeenCalledWith(1)
    expect(loaderData).toEqual({
      repo: mockRepository,
      issues: [
        { id: 1, title: 'Issue 1' },
        { id: 2, title: 'Issue 2' },
      ],
    })

    // Cleanup
    delete (window as any).loaderData
  })

  it('should work with React Query', async () => {
    const queryClient = createTestQueryClient()
    const mockFetchPosts = vi.fn().mockResolvedValue([
      { id: 1, title: 'Post 1' },
      { id: 2, title: 'Post 2' },
    ])

    let loaderData: any = null

    function PostsList() {
      const data = (window as any).loaderData
      loaderData = data
      return (
        <div data-testid="posts-list">
          {data?.map((post: any) => (
            <div key={post.id} data-testid={`post-${post.id}`}>
              {post.title}
            </div>
          ))}
        </div>
      )
    }

    const postsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/posts',
      component: PostsList,
      loader: async ({ context }) => {
        const data = await (context as any).queryClient.ensureQueryData({
          queryKey: ['posts'],
          queryFn: mockFetchPosts,
        })
        ;(window as any).loaderData = data
        return data
      },
    })

    renderWithRouter(null, {
      routes: [postsRoute],
      initialLocation: '/posts',
      context: { queryClient },
      queryClient,
    })

    await waitFor(() => {
      expect(screen.getByTestId('posts-list')).toBeInTheDocument()
    })

    expect(screen.getByTestId('post-1')).toHaveTextContent('Post 1')
    expect(screen.getByTestId('post-2')).toHaveTextContent('Post 2')
    expect(mockFetchPosts).toHaveBeenCalled()

    // Cleanup
    delete (window as any).loaderData
  })
})
