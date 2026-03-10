# 🏗️ Architecture Overview

This document explains how all the packages in this starter are integrated and work together.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Browser / Client                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  React Components                                                │
│  ├─ useSession() ──────────────┐ Better Auth Client             │
│  ├─ useQuery() ────────────────┤ TanStack Query                 │
│  ├─ useForm() ─────────────────┤ TanStack Form                  │
│  ├─ useStore() ────────────────┤ TanStack Store                 │
│  └─ useCollection() ───────────┘ TanStack DB                    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                  ↕ HTTP/WebSocket            ↕ Direct Upload (Presigned URL)
┌─────────────────────────────────────────────────────────────────┐
│                TanStack Start Server (SSR/API)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Server Functions (createServerFn)                               │
│  ├─ auth.api.getSession() ─────┐ Better Auth Server             │
│  ├─ db.select/insert/update ───┤ Drizzle ORM                    │
│  ├─ collections.subscribe() ───┤ TanStack DB                    │
│  └─ r2Client.send(commands) ───┘ R2 Client (AWS SDK)            │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
       ↕ SQL/Connection Pool                ↕ S3-compatible API
┌───────────────────────────┐     ┌───────────────────────────────┐
│  Neon PostgreSQL Database │     │    Cloudflare R2 Storage      │
├───────────────────────────┤     ├───────────────────────────────┤
│                           │     │                               │
│  Tables                   │     │  Objects (Files)              │
│  ├─ user, session         │     │  ├─ images/                   │
│  ├─ todos                 │     │  ├─ documents/                │
│  └─ notes                 │     │  └─ uploads/                  │
│                           │     │                               │
└───────────────────────────┘     └───────────────────────────────┘
```

## Package Integration Details

### 🔐 Better Auth + Drizzle

**How it works:**
1. Better Auth uses Drizzle adapter to store authentication data
2. Auth tables are defined in `src/db/schema.ts`
3. Session data is persisted in PostgreSQL via Drizzle
4. TanStack Start cookies plugin manages session cookies

**Code flow:**
```typescript
// src/lib/auth.ts
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '#/db/index'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  plugins: [tanstackStartCookies()],
})
```

**Files:**
- `src/lib/auth.ts` - Better Auth configuration
- `src/lib/auth-client.ts` - Client-side auth hooks
- `src/db/schema.ts` - Auth table definitions
- `src/integrations/better-auth/header-user.tsx` - UI component

### 🗄️ Drizzle + Neon

**How it works:**
1. Drizzle ORM connects to Neon using the HTTP driver (serverless-ready)
2. Schema is defined in TypeScript and synced to database
3. Type-safe queries generated from schema
4. Migrations managed via drizzle-kit

**Code flow:**
```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)
export const db = drizzle(sql, { schema })
```

**Files:**
- `src/db/index.ts` - Database client
- `src/db/schema.ts` - Table schemas
- `drizzle.config.ts` - Migration configuration
- `drizzle/` - Migration files (auto-generated)

### 🔄 TanStack Query + Router

**How it works:**
1. TanStack Query wraps server functions for caching
2. Router loader functions use Query for SSR
3. Query client passed through router context
4. Automatic cache invalidation and refetching

**Code flow:**
```typescript
// Server function
const getData = createServerFn({ method: 'GET' }).handler(async () => {
  return await db.select().from(notes)
})

// Component
const { data } = useQuery({
  queryKey: ['notes'],
  queryFn: getData,
})
```

**Files:**
- `src/integrations/tanstack-query/root-provider.tsx` - Query provider
- `src/integrations/tanstack-query/devtools.tsx` - DevTools plugin
- `src/router.tsx` - Router with query context

### 📝 TanStack Form

**How it works:**
1. Forms are defined with type-safe field access
2. Validation can be added at field or form level
3. Async submission integrated with mutations
4. Works with Zod for schema validation

**Code flow:**
```typescript
const form = useForm({
  defaultValues: { title: '', content: '' },
  onSubmit: async ({ value }) => {
    await createMutation.mutateAsync({ data: value })
  },
})
```

**Files:**
- `src/routes/demo/form.simple.tsx` - Basic form example
- `src/routes/demo/form.address.tsx` - Complex nested form
- `src/routes/demo/integrated.tsx` - Form with Query mutations

### 🏪 TanStack Store

**How it works:**
1. Global stores defined with type-safe state
2. Components subscribe to specific state slices
3. Fine-grained reactivity (only re-render on relevant changes)
4. DevTools integration for debugging

**Code flow:**
```typescript
const uiStore = new Store({
  isCreating: false,
  filter: 'all',
})

function Component() {
  const isCreating = useStore(uiStore, (state) => state.isCreating)
  
  return (
    <button onClick={() => 
      uiStore.setState((prev) => ({ ...prev, isCreating: true }))
    }>
      Create
    </button>
  )
}
```

**Files:**
- `src/lib/demo-store.ts` - Store definition
- `src/lib/demo-store-devtools.tsx` - DevTools plugin
- `src/routes/demo/store.tsx` - Store demo

### 💬 TanStack DB

**How it works:**
1. Collections can be local-only or synced with server
2. Server-side collections can stream changes to clients
3. Zod schemas validate data structure
4. Automatic subscription management

**Code flow:**
```typescript
// Server collection with streaming
const collection = createCollection(localOnlyCollectionOptions({
  getKey: (item) => item.id,
  schema: ItemSchema,
}))

// Stream changes via API route
export const Route = createFileRoute('/api/data')({
  server: {
    handlers: {
      GET: () => {
        const stream = new ReadableStream({
          start(controller) {
            collection.subscribeChanges((changes) => {
              controller.enqueue(JSON.stringify(changes))
            })
          },
        })
        return new Response(stream)
      },
    },
  },
})
```

**Files:**
- `src/db-collections/index.ts` - Collection definitions
- `src/routes/demo/db-chat-api.ts` - Streaming API
- `src/routes/demo/db-chat.tsx` - Real-time UI
- `src/components/demo.chat-area.tsx` - Chat component

### ☁️ Cloudflare R2

**How it works:**
1. R2 client uses AWS S3 SDK with Cloudflare endpoint
2. Files can be uploaded directly through server or via presigned URLs
3. Presigned URLs allow browser to upload directly to R2, bypassing server
4. Download URLs are also presigned with expiration times

**Code flow (Presigned URL upload):**
```typescript
// Step 1: Client requests presigned URL from server
const getUploadUrl = createServerFn()
  .handler(async ({ data }) => {
    const client = getR2Client()
    return await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: 'my-bucket',
        Key: data.fileName,
        ContentType: data.contentType,
      }),
      { expiresIn: 3600 }
    )
  })

// Step 2: Client uploads directly to R2
const url = await getUploadUrl({ 
  data: { fileName: 'image.png', contentType: 'image/png' } 
})

await fetch(url, {
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': 'image/png' },
})
```

**Benefits of presigned URLs:**
- Reduced server bandwidth (direct browser → R2)
- Better performance using Cloudflare's edge network
- Time-limited access (URLs expire)
- Content-Type restrictions for security

**Files:**
- `src/lib/r2.ts` - R2 client configuration
- `src/lib/r2-operations.ts` - Upload/download operations
- `src/routes/demo/r2.tsx` - File upload demo

## Authentication Flow

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │ 1. Sign Up/In
       ↓
┌─────────────────┐
│ Better Auth API │
└──────┬──────────┘
       │ 2. Validate & Hash Password
       ↓
┌─────────────────┐
│  Drizzle ORM    │
└──────┬──────────┘
       │ 3. Insert User & Session
       ↓
┌─────────────────┐
│  Neon Database  │
└──────┬──────────┘
       │ 4. Return Session
       ↓
┌─────────────────┐
│ Set HTTP Cookie │
└──────┬──────────┘
       │ 5. Session Cookie Stored
       ↓
┌─────────────┐
│   Browser   │
└─────────────┘
```

## Data Flow (CRUD Operations)

```
┌─────────────┐
│  Component  │
└──────┬──────┘
       │ 1. useMutation({ mutationFn: createNote })
       ↓
┌─────────────────┐
│ TanStack Query  │
└──────┬──────────┘
       │ 2. Call createNote({ data })
       ↓
┌─────────────────┐
│ Server Function │
└──────┬──────────┘
       │ 3. auth.getSession() & db.insert()
       ↓
┌─────────────────┐
│  Drizzle ORM    │
└──────┬──────────┘
       │ 4. INSERT INTO notes ...
       ↓
┌─────────────────┐
│  Neon Database  │
└──────┬──────────┘
       │ 5. Return inserted row
       ↓
┌─────────────────┐
│ Server Function │
└──────┬──────────┘
       │ 6. Return data to client
       ↓
┌─────────────────┐
│ TanStack Query  │
└──────┬──────────┘
       │ 7. invalidateQueries(['notes'])
       ↓
┌─────────────────┐
│  Component      │ - Auto refetch & re-render
└─────────────────┘
```

## State Management Strategy

Different types of state are handled by different packages:

| State Type | Package | Example | Persistence |
|------------|---------|---------|-------------|
| Server data | TanStack Query | User list, posts | Server + cache |
| Form state | TanStack Form | Input values, validation | Local only |
| UI state | TanStack Store | Filters, toggles, modals | Local only |
| Real-time data | TanStack DB | Chat messages, notifications | Streamed |
| Auth state | Better Auth | Current user, session | Server + cookie |
| File storage | Cloudflare R2 | Images, documents, uploads | Object storage |

## File Structure

```
src/
├── components/         # Reusable UI components
│   ├── ui/            # Shadcn components
│   └── demo.*         # Demo-specific components
├── db/                # Database configuration
│   ├── index.ts       # Drizzle client
│   └── schema.ts      # Table schemas
├── db-collections/    # TanStack DB collections
│   └── index.ts
├── hooks/             # Custom React hooks
│   └── demo.*         # Demo-specific hooks
├── integrations/      # Package integrations
│   ├── better-auth/   # Auth UI components
│   └── tanstack-query/# Query provider & devtools
├── lib/               # Utilities and configs
│   ├── auth.ts        # Better Auth server
│   ├── auth-client.ts # Better Auth client
│   ├── r2.ts          # R2 client configuration
│   ├── r2-operations.ts # R2 file operations
│   └── utils.ts       # Utility functions
└── routes/            # File-based routes
    ├── __root.tsx     # Root layout
    ├── index.tsx      # Home page
    └── demo/          # Demo pages
        ├── index.tsx            # Demo listing
        ├── integrated.tsx       # Full integration example
        ├── better-auth.tsx      # Auth demo
        ├── drizzle.tsx          # Database demo
        ├── tanstack-query.tsx   # Query demo
        ├── form.*.tsx           # Form demos
        ├── store.tsx            # Store demo
        ├── db-chat.tsx          # Real-time demo
        └── r2.tsx               # File storage demo
```

## DevTools

All packages include DevTools for debugging:

- **TanStack Router DevTools** - Route tree and navigation
- **TanStack Query DevTools** - Cache inspection and mutations
- **TanStack Store DevTools** - State snapshots and time travel
- **React DevTools** - Component tree and props (external)

Access DevTools via the floating icon in the bottom-right corner (development only).

## Production Considerations

### Performance
- **Database**: Neon HTTP driver is optimized for serverless/edge
- **Caching**: TanStack Query caches all server data
- **Rendering**: SSR with TanStack Router for fast initial load
- **Code Splitting**: Automatic with TanStack Router

### Security
- **Authentication**: Sessions stored server-side in database
- **Cookies**: HttpOnly, Secure, SameSite=Lax
- **Authorization**: Check session in `beforeLoad` hooks
- **Environment Variables**: Never expose secrets to client

### Scalability
- **Database**: Neon auto-scales with serverless architecture
- **State**: Fine-grained reactivity prevents unnecessary re-renders
- **API**: Server functions can be deployed to edge locations
- **Caching**: Smart invalidation reduces database queries

## Next Steps

1. Explore the [integrated demo](/demo/integrated) to see everything working together
2. Read individual package documentation (links in README)
3. Check out the [SETUP.md](./SETUP.md) for environment setup
4. Start building your own features using these patterns!
