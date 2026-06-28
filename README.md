# PushStack

A modern code repository platform for hosting, managing, and collaborating on your Git repositories.

## 🚀 Quick Start

```bash
pnpm install
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000) to get started.

## ✨ Features

- **Git Repository Hosting**: Host and manage Git repositories with full version control
- **Authentication**: Secure user authentication using Better Auth
- **Issue Tracking**: Track bugs, features, and tasks
- **Pull Requests**: Collaborate on code with pull requests and reviews
- **Code Viewer**: Browse code with syntax highlighting
- **Diff Viewer**: View changes with side-by-side or unified diff views
- **Database**: PostgreSQL database with Drizzle ORM
- **Storage**: Cloudflare R2 for repository storage

## 🔧 Environment Setup

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Generate Better Auth secret:
   ```bash
   pnpm dlx @better-auth/cli secret
   ```

3. Add the secret and your database URL to `.env.local`:
   ```env
   DATABASE_URL=postgresql://...
   BETTER_AUTH_SECRET=your_secret_key
   BETTER_AUTH_URL=http://localhost:3000
   R2_ACCESS_KEY_ID=your_r2_access_key
   R2_SECRET_ACCESS_KEY=your_r2_secret
   R2_BUCKET_NAME=your_bucket_name
   R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

4. Run database migrations:
   ```bash
   pnpm db:push
   ```

## 📁 Project Structure

```
src/
├── components/        # Reusable UI components
├── db/               # Database schema and client
├── hooks/            # Custom React hooks
├── integrations/     # Third-party integrations
├── lib/              # Utility functions and helpers
├── routes/           # File-based routing
└── server/           # Server-side functions
```

## 🛠️ Available Commands

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm preview      # Preview production build
pnpm test         # Run unit tests
pnpm test:e2e     # Run E2E tests
pnpm lint         # Lint code
pnpm format       # Format code
pnpm db:generate  # Generate migrations
pnpm db:push      # Push schema to database
pnpm db:migrate   # Run migrations
pnpm db:studio    # Open Drizzle Studio
```

## 🧪 Testing

This project uses Vitest for unit tests and Playwright for E2E tests.

## 🚢 Deployment

To build for production:

```bash
pnpm build
```

Deploy to Cloudflare Pages:

```bash
pnpm deploy
```

## 📚 Tech Stack

- **Framework**: TanStack Start
- **Database**: PostgreSQL (Neon)
- **ORM**: Drizzle
- **Authentication**: Better Auth
- **Storage**: Cloudflare R2
- **Styling**: Tailwind CSS
- **UI Components**: Shadcn
- **Testing**: Vitest, Playwright

## 📖 Documentation

For more detailed documentation, see:
- [SETUP.md](./SETUP.md) - Setup guide
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Architecture overview
- [AUTH.md](./AUTH.md) - Authentication system
- [TEST_GUIDE.md](./TEST_GUIDE.md) - Testing guide
