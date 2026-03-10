# Testing Documentation

This document describes the testing setup and patterns for the PushStack application.

## Overview

The project uses a comprehensive testing strategy with three levels of tests:

1. **Unit/Component Tests** - Testing individual route components and utilities (Vitest + React Testing Library)
2. **Integration Tests** - Testing complete user flows and feature interactions (Vitest + React Testing Library)
3. **End-to-End Tests** - Testing the entire application in a real browser (Playwright)

## Setup

### Testing Dependencies

All necessary testing dependencies are already installed:

- `vitest` - Fast unit test framework
- `@testing-library/react` - React component testing utilities
- `@testing-library/user-event` - User interaction simulation
- `@testing-library/jest-dom` - Custom Jest matchers for DOM
- `jsdom` - DOM implementation for Node.js

### Playwright (E2E Testing)

To run E2E tests, install Playwright:

```bash
npm install -D @playwright/test   
npx playwright install
```

## Running Tests

### Unit and Integration Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npx vitest run src/__tests__/routes/navigation.test.tsx
```

### E2E Tests

```bash
# Run E2E tests
npx playwright test

# Run E2E tests in UI mode
npx playwright test --ui

# Run specific test file
npx playwright test e2e/navigation.spec.ts

# Run tests in headed mode (see browser)
npx playwright test --headed

# Generate test report
npx playwright show-report
```

## Test Structure

```
src/
├── __tests__/
│   ├── routes/
│   │   ├── basic-routes.test.tsx
│   │   ├── navigation.test.tsx
│   │   ├── route-params.test.tsx
│   │   ├── data-loading.test.tsx
│   │   └── route-guards.test.tsx
│   └── integration/
│       └── user-flows.test.tsx
├── test/
│   ├── setup.ts              # Test environment setup
│   ├── router-utils.tsx      # Router testing utilities
│   └── mock-routes.tsx       # Mock data and test components
e2e/
├── navigation.spec.ts        # E2E navigation tests
├── auth.spec.ts             # E2E authentication tests
├── repositories.spec.ts     # E2E repository tests
└── fixtures.ts              # Playwright test fixtures
```

## Testing Patterns

### 1. Testing Route Components

```typescript
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { createRoute } from '@tanstack/react-router'
import { renderWithRouter, rootRoute } from '../../test/router-utils'

describe('Route Component', () => {
  it('should render route component', () => {
    const testRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <h1>Home Page</h1>,
    })

    renderWithRouter(<div />, {
      routes: [testRoute],
      initialLocation: '/',
    })

    expect(screen.getByText('Home Page')).toBeInTheDocument()
  })
})
```

### 2. Testing Navigation

```typescript
import userEvent from '@testing-library/user-event'
import { Link, createRoute } from '@tanstack/react-router'

it('should navigate when link is clicked', async () => {
  const user = userEvent.setup()

  function HomePage() {
    return <Link to="/about" data-testid="about-link">About</Link>
  }

  const { router } = renderWithRouter(<div />, {
    routes: [homeRoute, aboutRoute],
    initialLocation: '/',
  })

  await user.click(screen.getByTestId('about-link'))
  
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/about')
  })
})
```

### 3. Testing Route Parameters

```typescript
it('should handle route params', async () => {
  function UserProfile() {
    const params = (window as any).routeParams
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

  renderWithRouter(<div />, {
    routes: [userRoute],
    initialLocation: '/users/123',
  })

  expect(screen.getByText('User ID: 123')).toBeInTheDocument()
})
```

### 4. Testing Data Loading

```typescript
import { vi } from 'vitest'
import { waitFor } from '@testing-library/react'

it('should load data from loader', async () => {
  const mockFetchUser = vi.fn().mockResolvedValue({
    id: 1,
    name: 'John Doe',
  })

  const userRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/users/$userId',
    component: UserProfile,
    loader: ({ params }) => mockFetchUser(params.userId),
  })

  renderWithRouter(<div />, {
    routes: [userRoute],
    initialLocation: '/users/1',
  })

  await waitFor(() => {
    expect(screen.getByText('John Doe')).toBeInTheDocument()
  })
})
```

### 5. Testing Route Guards

```typescript
import { redirect } from '@tanstack/react-router'

it('should redirect unauthenticated users', async () => {
  const mockAuth = { isAuthenticated: false }

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

  renderWithRouter(<div />, {
    routes: [protectedRoute, loginRoute],
    initialLocation: '/protected',
  })

  await waitFor(() => {
    expect(screen.getByText('Login Required')).toBeInTheDocument()
  })
})
```

### 6. E2E Testing with Playwright

```typescript
import { test, expect } from '@playwright/test'

test('should navigate between pages', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('Build, collaborate')
  
  await page.click('text=About')
  await expect(page).toHaveURL('/about')
})
```

## Test Utilities

### Router Utilities (`src/test/router-utils.tsx`)

- `rootRoute` - Base root route for testing
- `createTestRouter()` - Create a router instance for testing
- `renderWithRouter()` - Render components with router context
- `createTestQueryClient()` - Create React Query client for testing

### Mock Data (`src/test/mock-routes.tsx`)

- `createMockRoute()` - Factory for creating test routes
- `TestComponent` - Generic test component
- `LoadingComponent` - Loading state component
- `ErrorComponent` - Error state component
- `mockUser` - Sample user data
- `mockRepository` - Sample repository data
- `mockIssue` - Sample issue data

## Best Practices

1. **Use descriptive test names** - Clearly describe what is being tested
2. **Follow AAA pattern** - Arrange, Act, Assert
3. **Test user behavior** - Focus on what users do, not implementation details
4. **Mock external dependencies** - Use `vi.fn()` for API calls
5. **Clean up after tests** - Reset mocks and global state
6. **Use data-testid** - For elements that need to be selected in tests
7. **Wait for async operations** - Use `waitFor()` for async state updates
8. **Test error states** - Don't only test happy paths
9. **Keep tests independent** - Each test should work in isolation
10. **Use fixtures for E2E** - Reuse common setup logic

## Adding New Tests

### 1. Add Unit/Component Test

Create a new file in `src/__tests__/`:

```typescript
// src/__tests__/routes/my-feature.test.tsx
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithRouter, rootRoute } from '../../test/router-utils'

describe('My Feature', () => {
  it('should work correctly', () => {
    // Your test here
  })
})
```

### 2. Add E2E Test

Create a new file in `e2e/`:

```typescript
// e2e/my-feature.spec.ts
import { test, expect } from '@playwright/test'

test.describe('My Feature E2E', () => {
  test('should work in browser', async ({ page }) => {
    await page.goto('/my-feature')
    // Your test here
  })
})
```

## Continuous Integration

For CI/CD pipelines, add these commands:

```yaml
# Run all tests
- npm test
- npx playwright test --project=chromium

# Generate coverage report
- npm run test:coverage
```

## Troubleshooting

### Tests timeout
- Increase timeout in `vitest.config.ts` or use `{ timeout: 10000 }` in test
- Check for unresolved promises or missing `await`

### Component not rendering
- Ensure proper router setup with `renderWithRouter`
- Check that routes are properly defined
- Verify component imports

### Playwright tests fail
- Make sure dev server is running on port 3000
- Check that `webServer` config in `playwright.config.ts` is correct
- Run with `--headed` flag to see what's happening

### Mock not working
- Clear mocks between tests: `vi.clearAllMocks()`
- Ensure mock is defined before component renders
- Check mock implementation logic

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Playwright Documentation](https://playwright.dev/)
- [TanStack Router Testing Guide](https://tanstack.com/router/latest/docs/framework/react/guide/testing)
