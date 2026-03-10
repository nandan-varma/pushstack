import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import { Store, useStore } from '@tanstack/react-store'
import { auth } from '#/lib/auth'
import { db } from '#/db/index'
import { eq, desc } from 'drizzle-orm'
import { notes } from '#/db/schema'
import { authClient } from '#/lib/auth-client'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { Switch } from '#/components/ui/switch'
import { Label } from '#/components/ui/label'

// 🏪 TanStack Store - Global UI State
const uiStore = new Store({
  isCreating: false,
  filter: 'all' as 'all' | 'public' | 'private',
})

// 🔐 Server Functions with Better Auth
const getSession = createServerFn({
  method: 'GET',
}).handler(async () => {
  return await auth.api.getSession({ headers: new Headers() })
})

// 🗄️ Server Functions with Drizzle ORM
const getNotes = createServerFn({
  method: 'GET',
}).handler(async () => {
  const session = await auth.api.getSession({ headers: new Headers() })
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  return await db
    .select()
    .from(notes)
    .where(eq(notes.userId, session.user.id))
    .orderBy(desc(notes.createdAt))
})

const createNote = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { title: string; content: string; isPublic: boolean }) => data)
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: new Headers() })
    if (!session?.user?.id) {
      throw new Error('Unauthorized')
    }

    const [note] = await db
      .insert(notes)
      .values({
        title: data.title,
        content: data.content,
        isPublic: data.isPublic,
        userId: session.user.id,
        updatedAt: new Date(),
      })
      .returning()

    return note
  })

const deleteNote = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: new Headers() })
    if (!session?.user?.id) {
      throw new Error('Unauthorized')
    }

    await db.delete(notes).where(eq(notes.id, data.id))
    return { success: true }
  })

// Route with authentication check
export const Route = createFileRoute('/demo/integrated')({
  beforeLoad: async () => {
    const session = await getSession()
    if (!session?.user) {
      throw redirect({
        to: '/demo/better-auth',
        search: { redirect: '/demo/integrated' },
      })
    }
  },
  component: IntegratedDemo,
})

function IntegratedDemo() {
  const { data: session } = authClient.useSession()
  const queryClient = useQueryClient()
  const isCreating = useStore(uiStore, (state) => state.isCreating)
  const filter = useStore(uiStore, (state) => state.filter)

  // 🔄 TanStack Query - Data Fetching
  const { data: allNotes = [], isLoading } = useQuery({
    queryKey: ['notes'],
    queryFn: () => getNotes(),
  })

  // Filter notes based on store state
  const filteredNotes =
    filter === 'all'
      ? allNotes
      : allNotes.filter((note) => (filter === 'public' ? note.isPublic : !note.isPublic))

  // 🔄 TanStack Query - Mutations
  const createMutation = useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      uiStore.setState((state) => ({ ...state, isCreating: false }))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
  })

  // 📝 TanStack Form - Form Handling
  const form = useForm({
    defaultValues: {
      title: '',
      content: '',
      isPublic: false,
    },
    onSubmit: async ({ value }) => {
      await createMutation.mutateAsync({ data: value })
      form.reset()
    },
  })

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-4 py-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-8 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                🎯 Integrated Stack Demo
              </h1>
              <p className="text-slate-600 dark:text-slate-400">
                All packages working together seamlessly
              </p>
            </div>
            <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-700 border border-blue-200 dark:border-slate-600">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white font-bold">
                {session?.user?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {session?.user?.name}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {session?.user?.email}
                </p>
              </div>
            </div>
          </div>

          {/* Technology Stack Display */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6">
            {[
              { name: 'Better Auth', icon: '🔐', color: 'blue' },
              { name: 'Drizzle ORM', icon: '🗄️', color: 'green' },
              { name: 'TanStack Query', icon: '🔄', color: 'red' },
              { name: 'TanStack Form', icon: '📝', color: 'purple' },
              { name: 'TanStack Store', icon: '🏪', color: 'orange' },
            ].map((tech) => (
              <div
                key={tech.name}
                className="flex flex-col items-center gap-1 p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <span className="text-2xl">{tech.icon}</span>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 text-center">
                  {tech.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  uiStore.setState((state) => ({ ...state, filter: 'all' }))
                }
                variant={filter === 'all' ? 'default' : 'outline'}
                size="sm"
              >
                All ({allNotes.length})
              </Button>
              <Button
                onClick={() =>
                  uiStore.setState((state) => ({ ...state, filter: 'public' }))
                }
                variant={filter === 'public' ? 'default' : 'outline'}
                size="sm"
              >
                Public ({allNotes.filter((n) => n.isPublic).length})
              </Button>
              <Button
                onClick={() =>
                  uiStore.setState((state) => ({ ...state, filter: 'private' }))
                }
                variant={filter === 'private' ? 'default' : 'outline'}
                size="sm"
              >
                Private ({allNotes.filter((n) => !n.isPublic).length})
              </Button>
            </div>
            <Button
              onClick={() =>
                uiStore.setState((state) => ({ ...state, isCreating: !state.isCreating }))
              }
            >
              {isCreating ? '✕ Cancel' : '+ New Note'}
            </Button>
          </div>
        </div>

        {/* Create Note Form */}
        {isCreating && (
          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 mb-6">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
              Create New Note
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                form.handleSubmit()
              }}
              className="space-y-4"
            >
              <form.Field name="title">
                {(field) => (
                  <div>
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Enter note title..."
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="content">
                {(field) => (
                  <div>
                    <Label htmlFor="content">Content</Label>
                    <Textarea
                      id="content"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Write your note..."
                      rows={4}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="isPublic">
                {(field) => (
                  <div className="flex items-center gap-2">
                    <Switch
                      id="isPublic"
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(checked)}
                    />
                    <Label htmlFor="isPublic">Make this note public</Label>
                  </div>
                )}
              </form.Field>

              <Button type="submit" disabled={createMutation.isPending} className="w-full">
                {createMutation.isPending ? 'Creating...' : 'Create Note'}
              </Button>
            </form>
          </div>
        )}

        {/* Notes List */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-12 text-center">
              <div className="h-8 w-8 mx-auto border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
              <p className="mt-4 text-slate-600 dark:text-slate-400">Loading notes...</p>
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-12 text-center">
              <div className="text-6xl mb-4">📝</div>
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                No notes yet
              </h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Create your first note to get started!
              </p>
              <Button
                onClick={() =>
                  uiStore.setState((state) => ({ ...state, isCreating: true }))
                }
              >
                Create Note
              </Button>
            </div>
          ) : (
            filteredNotes.map((note) => (
              <div
                key={note.id}
                className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 hover:shadow-2xl transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {note.title}
                      </h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          note.isPublic
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {note.isPublic ? '🌐 Public' : '🔒 Private'}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {new Date(note.createdAt).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteMutation.mutate({ data: { id: note.id } })}
                    disabled={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                </div>
                <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {note.content}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <a
            href="/demo"
            className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 font-medium"
          >
            ← Back to Demos
          </a>
        </div>
      </div>
    </main>
  )
}
