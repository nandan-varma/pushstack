Welcome to your new TanStack Start app! 

This starter comes with a fully integrated stack including **Better Auth**, **Drizzle ORM**, **TanStack Query**, **TanStack Form**, **TanStack Store**, **TanStack DB**, **Neon Database**, and more - all configured to work seamlessly together.

> 📖 **First time setup?** Check out [SETUP.md](./SETUP.md) for a step-by-step guide!

# 🚀 Quick Start

To run this application:

```bash
pnpm install
pnpm dev
```

Visit [http://localhost:3000/demo](http://localhost:3000/demo) to see all the integrated examples.

# 📦 Integrated Stack

This starter includes the following packages, fully integrated and ready to use:

## 🔐 Authentication - Better Auth

Better Auth is integrated with Drizzle ORM for persistent session storage in your Neon PostgreSQL database.

**Features:**
- Email/Password authentication
- Session management with database persistence
- TanStack Start cookies plugin for SSR support
- User, session, account, and verification tables

**Setup:**
1. Generate and set `BETTER_AUTH_SECRET` in `.env.local`:
   ```bash
   pnpm dlx @better-auth/cli secret
   ```

2. The database tables are automatically created when you run migrations (see Database Setup below).

**Usage:**
```tsx
import { authClient } from '#/lib/auth-client'

function MyComponent() {
  const { data: session } = authClient.useSession()
  
  if (session?.user) {
    return <div>Welcome {session.user.name}!</div>
  }
  
  return <button onClick={() => authClient.signIn.email({ email, password })}>
    Sign In
  </button>
}
```

See [/demo/better-auth](http://localhost:3000/demo/better-auth) for a complete example.

## 🗄️ Database - Drizzle ORM + Neon

Drizzle ORM is configured with the Neon serverless driver for edge-ready database queries.

**Features:**
- Type-safe SQL queries
- Schema-first approach
- Migrations with `drizzle-kit`
- Serverless-ready with Neon HTTP driver

**Database Setup:**

When you run `pnpm dev`, the Neon vite plugin will help you create and claim a database.

To run migrations and set up all tables (including Better Auth tables):

```bash
pnpm db:generate  # Generate migration files from schema
pnpm db:push      # Push schema changes to database (dev)
# OR for production
pnpm db:migrate   # Run migrations
```

**Schema Location:** `src/db/schema.ts`

**Usage:**
```tsx
import { db } from '#/db/index'
import { todos } from '#/db/schema'

// Query
const allTodos = await db.select().from(todos)

// Insert
await db.insert(todos).values({ title: 'New todo' })
```

**Available Commands:**
- `pnpm db:generate` - Generate migrations from schema
- `pnpm db:migrate` - Run migrations
- `pnpm db:push` - Push schema (dev only)
- `pnpm db:pull` - Pull schema from database
- `pnpm db:studio` - Open Drizzle Studio

See [/demo/drizzle](http://localhost:3000/demo/drizzle) for a complete example.

## 🔄 Data Fetching - TanStack Query

TanStack Query is integrated with TanStack Router for SSR-aware data loading.

**Features:**
- Automatic caching and refetching
- Optimistic updates
- SSR support with dehydration
- DevTools integration

**Usage:**
```tsx
import { useQuery, useMutation } from '@tanstack/react-query'

function MyComponent() {
  const { data, isLoading } = useQuery({
    queryKey: ['todos'],
    queryFn: getTodos,
  })
  
  const mutation = useMutation({
    mutationFn: createTodo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] })
    },
  })
  
  return (
    <button onClick={() => mutation.mutate({ title: 'New todo' })}>
      Create Todo
    </button>
  )
}
```

See [/demo/tanstack-query](http://localhost:3000/demo/tanstack-query) for a complete example.

## 📝 Forms - TanStack Form

TanStack Form provides type-safe form handling with validation.

**Features:**
- Type-safe field access
- Built-in validation
- Field-level error handling
- Async submission

**Usage:**
```tsx
import { useForm } from '@tanstack/react-form'

function MyForm() {
  const form = useForm({
    defaultValues: { email: '', password: '' },
    onSubmit: async ({ value }) => {
      await submitForm(value)
    },
  })
  
  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit() }}>
      <form.Field name="email">
        {(field) => (
          <input
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
          />
        )}
      </form.Field>
    </form>
  )
}
```

See [/demo/form.simple](http://localhost:3000/demo/form.simple) for a complete example.

## 🏪 State Management - TanStack Store

TanStack Store provides reactive global state management.

**Features:**
- Fine-grained reactivity
- Simple API
- DevTools integration
- TypeScript support

**Usage:**
```tsx
import { Store, useStore } from '@tanstack/react-store'

const myStore = new Store({
  count: 0,
})

function MyComponent() {
  const count = useStore(myStore, (state) => state.count)
  
  return (
    <button onClick={() => myStore.setState((prev) => ({ count: prev.count + 1 }))}>
      Count: {count}
    </button>
  )
}
```

See [/demo/store](http://localhost:3000/demo/store) for a complete example.

## 💬 Real-time Data - TanStack DB

TanStack DB provides reactive collections for real-time updates.

**Features:**
- Client and server-side collections
- Automatic synchronization
- Streaming API support
- Schema validation with Zod

**Usage:**
```tsx
import { createCollection, localOnlyCollectionOptions } from '@tanstack/react-db'

const messagesCollection = createCollection(
  localOnlyCollectionOptions({
    getKey: (message) => message.id,
    schema: MessageSchema,
  })
)

// Subscribe to changes
messagesCollection.subscribeChanges((changes) => {
  // Handle updates
})
```

See [/demo/db-chat](http://localhost:3000/demo/db-chat) for a complete example.

# 🎯 Full Stack Integration Example

Visit [/demo/integrated](http://localhost:3000/demo/integrated) to see all packages working together in a real-world notes app that features:

- **Better Auth** - User authentication and authorization
- **Drizzle ORM** - Database operations with type safety
- **TanStack Query** - Data fetching with caching
- **TanStack Form** - Form handling with validation
- **TanStack Store** - UI state management
- **Neon Database** - Serverless PostgreSQL

This example demonstrates how to build a complete feature using the entire stack.

# 🎨 UI Components - Shadcn

Add components using the latest version of [Shadcn](https://ui.shadcn.com/).

```bash
pnpm dlx shadcn@latest add button
```

All demo pages use Shadcn components for consistent UI. 

# 🏗️ Building For Production

To build this application for production:

```bash
pnpm build
```

Deploy to Cloudflare Pages:

```bash
pnpm deploy
```

## ⚙️ Environment Variables

Required environment variables for production:

```
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=your_secret_key
BETTER_AUTH_URL=https://yourdomain.com
```

# 🧪 Testing

This project uses [Vitest](https://vitest.dev/) for testing. You can run the tests with:

```bash
pnpm test
```

# 🎨 Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Uninstall the packages: `pnpm remove @tailwindcss/vite tailwindcss`

## 🔍 Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:

```bash
pnpm lint
pnpm format
pnpm check
```

# 🗺️ Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

# 🔧 Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')
  
  useEffect(() => {
    getServerTime().then(setTime)
  }, [])
  
  return <div>Server time: {time}</div>
}
```

# 🌐 API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

# 📊 Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

# 🛠️ How It All Works Together

## Database Integration Flow

1. **Schema Definition** (`src/db/schema.ts`): Define your tables using Drizzle's schema builder
2. **Database Client** (`src/db/index.ts`): Drizzle connected to Neon serverless
3. **Better Auth Integration** (`src/lib/auth.ts`): Uses Drizzle adapter to store auth data
4. **Migrations**: Run `pnpm db:generate` and `pnpm db:push` to sync schema

## Authentication Flow

1. User signs up/in via Better Auth
2. Session stored in database via Drizzle adapter
3. Session cookie set via TanStack Start cookies plugin
4. Protected routes check session in `beforeLoad`
5. Client components access session via `authClient.useSession()`

## Data Flow

1. **Server Functions** (`createServerFn`): Define server-side operations
2. **TanStack Query**: Wrap server functions for caching and reactivity
3. **Components**: Use `useQuery` and `useMutation` hooks
4. **Database**: Server functions interact with Drizzle/Neon
5. **UI Updates**: Query invalidation triggers automatic refetches

## State Management

- **Server State**: TanStack Query (data from APIs/database)
- **Form State**: TanStack Form (form values and validation)
- **UI State**: TanStack Store (toggles, filters, ephemeral state)
- **Real-time State**: TanStack DB (streaming data and collections)

# 📝 Demo Files

Files prefixed with `demo` can be safely deleted. They are there to provide examples of:

- **Better Auth**: User authentication and sign-in flows
- **Drizzle ORM**: Database queries and mutations
- **TanStack Query**: Data fetching and caching patterns
- **TanStack Form**: Form handling with validation
- **TanStack Store**: Global state management
- **TanStack DB**: Real-time collections and streaming
- **Full Integration**: All packages working together

Visit [/demo](http://localhost:3000/demo) to explore all examples.

# 📚 Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).

## Package Documentation

- [Better Auth](https://www.better-auth.com) - Authentication
- [Drizzle ORM](https://orm.drizzle.team) - Database ORM
- [TanStack Query](https://tanstack.com/query) - Data fetching
- [TanStack Form](https://tanstack.com/form) - Form handling
- [TanStack Store](https://tanstack.com/store) - State management
- [TanStack Router](https://tanstack.com/router) - Routing
- [TanStack DB](https://tanstack.com/db) - Real-time collections
- [Neon](https://neon.tech) - Serverless PostgreSQL
- [Shadcn UI](https://ui.shadcn.com) - UI components
- [Tailwind CSS](https://tailwindcss.com) - Styling
