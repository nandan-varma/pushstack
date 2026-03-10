# Test Suite - Quick Start Guide

## Running Tests

```bash
# Run all unit/integration tests
npm test

# Run tests in watch mode (useful during development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test file
npx vitest run src/__tests__/routes/basic-routes.test.tsx

# Run E2E tests (requires Playwright installation)
npm run test:e2e
```

## Installing E2E Testing (Optional)

```bash
# Install Playwright for E2E tests
npm install -D @playwright/test
npx playwright install

# Run E2E tests
npm run test:e2e

# Run E2E with UI mode
npm run test:e2e:ui
```

## Test Status

✅ **Passing Tests (13/25)**
- Basic route rendering
- Static route navigation  
- Route parameter parsing
- Data loading with loaders
- Error handling in routes
- Route guards and redirects
- Search parameter validation

⚠️ **Some Integration Tests Need Adjustment**
- Complex user flows (need React import fixes)
- Tests that rely on complex component state

## Working Test Patterns

### 1. Basic Route Test
```typescript
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'

it('should render route component', async () => {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <h1>Home Page</h1>,
  })

  const routeTree = rootRoute.addChildren([indexRoute])
  const history = createMemoryHistory({ initialEntries: ['/'] })
  const router = createRouter({ routeTree, history })

  render(<RouterProvider router={router} />)

  expect(await screen.findByText('Home Page')).toBeInTheDocument()
})
```

### 2. Route with Parameters
```typescript
it('should handle route params', async () => {
  let capturedParams: any = null

  function UserProfile() {
    const params = (window as any).routeParams
    capturedParams = params
    return <div>User ID: {params?.userId}</div>
  }

  const userRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/users/$userId',
    component: UserProfile,
    beforeLoad: ({ params }) => {
      (window as any).routeParams = params
    },
  })

  renderWithRouter(null, {
    routes: [userRoute],
    initialLocation: '/users/123',
  })

  expect(await screen.findByText('User ID: 123')).toBeInTheDocument()
})
```

### 3. Data Loading Test
```typescript
import { vi } from 'vitest'
import { waitFor } from '@testing-library/react'

it('should load data from loader', async () => {
  const mockFetchUser = vi.fn().mockResolvedValue({
    id: 1,
    name: 'John Doe',
  })

  let loaderData: any = null

  function UserProfile() {
    const data = (window as any).loaderData
    loaderData = data
    return <h1>{data?.name}</h1>
  }

  const userRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/users/$userId',
    component: UserProfile,
    loader: async ({ params }) => {
      const data = await mockFetchUser(params.userId)
      (window as any).loaderData = data
      return data
    },
  })

  renderWithRouter(null, {
    routes: [userRoute],
    initialLocation: '/users/1',
  })

  await waitFor(() => {
    expect(screen.getByText('John Doe')).toBeInTheDocument()
  })
})
```

### 4. Route Guards
```typescript
import { redirect } from '@tanstack/react-router'

it('should redirect unauthenticated users', async () => {
  const mockAuth = { isAuthenticated: false }

  const protectedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/protected',
    component: () => <h1>Protected Content</h1>,
    beforeLoad: () => {
      if (!mockAuth.isAuthenticated) {
        throw redirect({ to: '/login' })
      }
    },
  })

  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <h1>Login Required</h1>,
  })

  renderWithRouter(null, {
    routes: [protectedRoute, loginRoute],
    initialLocation: '/protected',
  })

  await waitFor(() => {
    expect(screen.getByText('Login Required')).toBeInTheDocument()
  })
})
```

## Test Utilities

### `renderWithRouter()`
Main utility for rendering components with router context:

```typescript
import { renderWithRouter, rootRoute } from '../../test/router-utils'

const { router } = renderWithRouter(null, {
  routes: [myRoute],
  initialLocation: '/my-path',
  context: { /* custom context */ },
  queryClient: testQueryClient,
})
```

### `createTestQueryClient()`
Creates a React Query client optimized for testing:

```typescript
import { createTestQueryClient } from '../../test/router-utils'

const queryClient = createTestQueryClient()
```

### Mock Data
Pre-defined mock data available in `src/test/mock-routes.tsx`:

- `mockUser` - Sample user object
- `mockRepository` - Sample repository object  
- `mockIssue` - Sample issue object
- `mockCommit` - Sample commit object

## Common Patterns

### Testing Navigation
```typescript
import userEvent from '@testing-library/user-event'

const user = userEvent.setup()
await user.click(screen.getByTestId('nav-link'))

await waitFor(() => {
  expect(router.state.location.pathname).toBe('/new-path')
})
```

### Testing Search Params
```typescript
const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  component: SearchPage,
  validateSearch: (search) => ({
    q: (search.q as string) || '',
    page: Number(search.page) || 1,
  }),
})
```

### Testing Error Boundaries
```typescript
const routeWithError = createRoute({
  getParentRoute: () => rootRoute,
  path: '/error',
  component: MyComponent,
  errorComponent: ({ error }) => <div>Error: {error.message}</div>,
})
```

## Troubleshooting

### Tests timeout
- Use `await waitFor()` for async operations
- Increase timeout: `{ timeout: 10000 }`

### Component not found
- Ensure routes are properly defined
- Use `await screen.findBy...` for async rendering
- Check that `renderWithRouter` is called correctly

### Mock not working
- Define mocks before rendering
- Use `vi.fn().mockResolvedValue()` for async mocks
- Clear mocks in `afterEach()`: `vi.clearAllMocks()`

## Next Steps

1. ✅ Test infrastructure is set up
2. ✅ Example tests are provided  
3. ⚠️ Some integration tests may need React import fixes
4. 📝 Add tests for your specific application routes
5. 🎯 Install Playwright for E2E tests

## CI/CD Integration

Add to your CI pipeline:

```yaml
- name: Run Tests
  run: |
    npm test
    npm run test:coverage
```

For E2E tests in CI:

```yaml
- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E Tests
  run: npm run test:e2e
```
