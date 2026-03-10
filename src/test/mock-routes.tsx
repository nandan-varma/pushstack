import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './router-utils'
import type { ReactNode } from 'react'

export const createMockRoute = (
  path: string,
  component: React.ComponentType,
  options: any = {},
) => {
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    component,
    ...options,
  })
}

// Common test components
export function TestComponent({ title = 'Test' }: { title?: string }) {
  return <div data-testid="test-component">{title}</div>
}

export function LoadingComponent() {
  return <div data-testid="loading">Loading...</div>
}

export function ErrorComponent({ error }: { error: Error }) {
  return <div data-testid="error">Error: {error.message}</div>
}

export function LayoutComponent({ children }: { children: ReactNode }) {
  return (
    <div data-testid="layout">
      <header data-testid="header">Header</header>
      <main>{children}</main>
      <footer data-testid="footer">Footer</footer>
    </div>
  )
}

// Mock data for testing
export const mockUser = {
  id: '1',
  name: 'Test User',
  email: 'test@example.com',
}

export const mockRepository = {
  id: 1,
  name: 'test-repo',
  owner: 'test-owner',
  description: 'Test repository description',
  visibility: 'public',
  defaultBranch: 'main',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ownerId: '1',
}

export const mockIssue = {
  id: 1,
  title: 'Test Issue',
  body: 'This is a test issue',
  status: 'open',
  author: mockUser,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  repositoryId: 1,
  authorId: '1',
}

export const mockCommit = {
  sha: 'abc123',
  message: 'Test commit',
  author: {
    name: 'Test User',
    email: 'test@example.com',
  },
  date: new Date('2024-01-01'),
}
