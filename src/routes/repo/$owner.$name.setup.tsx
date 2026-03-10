import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/repo/$owner/$name/setup')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/repo/$owner/$name/setup"!</div>
}
