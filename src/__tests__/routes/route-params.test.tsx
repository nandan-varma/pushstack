import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { createRoute } from '@tanstack/react-router'
import { renderWithRouter, rootRoute } from '../../test/router-utils'

describe('Route Parameters', () => {
  it('should parse and use route params', async () => {
    let capturedParams: any = null

    function UserProfile() {
      const params = (window as any).routeParams
      capturedParams = params
      return (
        <div data-testid="user-profile">
          <h1>User Profile</h1>
          <p data-testid="user-id">User ID: {params?.userId}</p>
        </div>
      )
    }

    const userRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/users/$userId',
      component: UserProfile,
      beforeLoad: ({ params }) => {
        ;(window as any).routeParams = params
      },
    })

    renderWithRouter(null, {
      routes: [userRoute],
      initialLocation: '/users/123',
    })

    expect(await screen.findByTestId('user-profile')).toBeInTheDocument()
    expect(screen.getByTestId('user-id')).toHaveTextContent('User ID: 123')
    expect(capturedParams?.userId).toBe('123')

    // Cleanup
    delete (window as any).routeParams
  })

  it('should handle multiple route parameters', async () => {
    let capturedParams: any = null

    function RepoFile() {
      const params = (window as any).routeParams
      capturedParams = params
      return (
        <div data-testid="repo-file">
          <p data-testid="owner">Owner: {params?.owner}</p>
          <p data-testid="repo">Repo: {params?.name}</p>
          <p data-testid="branch">Branch: {params?.branch}</p>
        </div>
      )
    }

    const repoFileRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/repo/$owner/$name/blob/$branch',
      component: RepoFile,
      beforeLoad: ({ params }) => {
        ;(window as any).routeParams = params
      },
    })

    renderWithRouter(null, {
      routes: [repoFileRoute],
      initialLocation: '/repo/testuser/testrepo/blob/main',
    })

    expect(await screen.findByTestId('repo-file')).toBeInTheDocument()
    expect(screen.getByTestId('owner')).toHaveTextContent('Owner: testuser')
    expect(screen.getByTestId('repo')).toHaveTextContent('Repo: testrepo')
    expect(screen.getByTestId('branch')).toHaveTextContent('Branch: main')

    expect(capturedParams).toEqual({
      owner: 'testuser',
      name: 'testrepo',
      branch: 'main',
    })

    // Cleanup
    delete (window as any).routeParams
  })

  it('should handle search params correctly', async () => {
    let capturedSearch: any = null

    function SearchPage() {
      const search = (window as any).routeSearch
      capturedSearch = search
      return (
        <div data-testid="search-results">
          <p data-testid="query">Query: {search?.q}</p>
          <p data-testid="page">Page: {search?.page}</p>
          <p data-testid="filter">Filter: {search?.filter}</p>
        </div>
      )
    }

    const searchRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/search',
      component: SearchPage,
      validateSearch: (search) => {
        const validated = {
          q: (search.q as string) || '',
          page: Number(search.page) || 1,
          filter: (search.filter as string) || 'all',
        }
        ;(window as any).routeSearch = validated
        return validated
      },
    })

    renderWithRouter(null, {
      routes: [searchRoute],
      initialLocation: '/search?q=react&page=2&filter=recent',
    })

    expect(await screen.findByTestId('search-results')).toBeInTheDocument()
    expect(screen.getByTestId('query')).toHaveTextContent('Query: react')
    expect(screen.getByTestId('page')).toHaveTextContent('Page: 2')
    expect(screen.getByTestId('filter')).toHaveTextContent('Filter: recent')

    expect(capturedSearch).toEqual({
      q: 'react',
      page: 2,
      filter: 'recent',
    })

    // Cleanup
    delete (window as any).routeSearch
  })

  it('should handle wildcard routes', async () => {
    let capturedParams: any = null

    function CatchAll() {
      const params = (window as any).routeParams
      capturedParams = params
      return (
        <div data-testid="catch-all">
          <p data-testid="splat">Path: {params?.['*']}</p>
        </div>
      )
    }

    const catchAllRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/docs/$',
      component: CatchAll,
      beforeLoad: ({ params }) => {
        ;(window as any).routeParams = params
      },
    })

    renderWithRouter(null, {
      routes: [catchAllRoute],
      initialLocation: '/docs/getting-started/installation',
    })

    expect(await screen.findByTestId('catch-all')).toBeInTheDocument()
    expect(screen.getByTestId('splat')).toHaveTextContent(
      'Path: getting-started/installation',
    )

    // Cleanup
    delete (window as any).routeParams
  })
})
