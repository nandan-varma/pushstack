import React from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import {
  createRouter,
  createRootRoute,
  RouterProvider,
  Outlet,
  type AnyRoute,
} from '@tanstack/react-router'
import { createMemoryHistory } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Create a root route for testing
export const rootRoute = createRootRoute({
  component: () => <Outlet />,
})

// Test router factory
export function createTestRouter(
  routes: AnyRoute[],
  options: {
    initialLocation?: string
    context?: any
  } = {},
) {
  const { initialLocation = '/', context } = options

  const routeTree = rootRoute.addChildren(routes)

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [initialLocation],
    }),
    context,
  })

  return router
}

// Wrapper component for testing
interface RouterWrapperProps {
  children?: ReactNode
  router: any
  queryClient?: QueryClient
}

function RouterWrapper({ children, router, queryClient }: RouterWrapperProps) {
  const Wrapper = queryClient ? (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  ) : (
    <RouterProvider router={router} />
  )

  return Wrapper
}

// Custom render function with router
interface RenderWithRouterOptions extends Omit<RenderOptions, 'wrapper'> {
  router?: any
  initialLocation?: string
  routes?: AnyRoute[]
  context?: any
  queryClient?: QueryClient
}

export function renderWithRouter(
  ui: React.ReactElement | null = null,
  {
    router,
    initialLocation = '/',
    routes = [],
    context,
    queryClient,
    ...renderOptions
  }: RenderWithRouterOptions = {},
) {
  if (!router && routes.length > 0) {
    router = createTestRouter(routes, { initialLocation, context })
  }

  if (!router) {
    throw new Error(
      'Router is required. Provide either a router or routes array.',
    )
  }

  // If no UI is provided, just render the router
  const content = ui || <RouterWrapper router={router} queryClient={queryClient} />

  function Wrapper({ children }: { children: ReactNode }) {
    if (queryClient) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }
    return <>{children}</>
  }

  const result = ui
    ? {
        ...render(content, { wrapper: Wrapper, ...renderOptions }),
        router,
      }
    : {
        ...render(content, { ...renderOptions }),
        router,
      }

  return result
}

// Create a test QueryClient with sensible defaults
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}
