# 🚀 Setup Guide

Follow these steps to get your integrated TanStack Start application up and running.

## Prerequisites

- Node.js 18+ installed
- pnpm package manager (`npm install -g pnpm`)

## Step 1: Install Dependencies

```bash
pnpm install
```

## Step 2: Set Up Environment Variables

Create a `.env.local` file in the root directory:

```bash
# Copy the example file
cp .env.example .env.local
```

### Required Configuration

**1. Database (PostgreSQL with Neon)**

Sign up for a free Neon account at https://neon.tech and create a new project. Copy your connection string:

```env
DATABASE_URL=postgresql://user:password@host/database
```

**2. Better Auth**

Generate a secure secret:

```bash
# Generate Better Auth secret
pnpm dlx @better-auth/cli secret
```

Add the generated secret to `.env.local`:

```env
BETTER_AUTH_SECRET=your_generated_secret_here
BETTER_AUTH_URL=http://localhost:3000
```

**Optional - Cloudflare R2 (for file uploads):**

If you want to use R2 storage for backups and LFS:

```env
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET_NAME=your_bucket_name
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

**Optional - Git Repository Path:**

By default, repositories are stored in `data/repos`. You can customize this:

```env
GIT_REPOS_PATH=/path/to/git/repos
```

## Step 3: Initialize Database

Push your schema to the database:

```bash
pnpm drizzle-kit push
```

This will sync your schema directly to the Neon database without using migration files.

## Step 4: Start Development Server

```bash
pnpm dev
```

When you run this command for the first time, the Neon vite plugin will:
1. Detect that no database is configured
2. Create a claimable Neon database for you
3. Provide a link to claim and keep the database

**Important:** Claimable databases expire in 72 hours. Make sure to claim yours!

## Step 4: Set Up Database Tables

Once you have your `DATABASE_URL` (automatically set by the Neon plugin), push the schema to create all tables:

```bash
# Push schema to database (development)
pnpm db:push
```

This will create:
- Better Auth tables (user, session, account, verification)
- Demo tables (todos, notes)

For production, use migrations instead:

```bash
# Generate migration files
pnpm db:generate

# Run migrations
pnpm db:migrate
```

## Step 5: Explore the Demos

Visit [http://localhost:3000/demo](http://localhost:3000/demo) to see all integrated examples:

1. **Full Stack Integration** (`/demo/integrated`) - Complete app using all packages
2. **Better Auth** (`/demo/better-auth`) - Sign up and authentication
3. **Drizzle ORM** (`/demo/drizzle`) - Database queries
4. **TanStack Query** (`/demo/tanstack-query`) - Data fetching
5. **TanStack Form** (`/demo/form.simple`) - Form handling
6. **TanStack Store** (`/demo/store`) - State management
7. **TanStack DB** (`/demo/db-chat`) - Real-time collections
8. **Cloudflare R2** (`/demo/r2`) - File uploads with presigned URLs

## Quick Command Reference

```bash
# Development
pnpm dev              # Start dev server
pnpm build            # Build for production
pnpm preview          # Preview production build

# Database
pnpm db:push          # Push schema (dev only)
pnpm db:generate      # Generate migrations
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Drizzle Studio

# Code Quality
pnpm lint             # Lint code
pnpm format           # Format code
pnpm check            # Check formatting
pnpm test             # Run tests

# Deployment
pnpm deploy           # Deploy to Cloudflare Pages
```

## Troubleshooting

### Database Connection Issues

If you see database connection errors:
1. Make sure `DATABASE_URL` is set in `.env.local`
2. Run `pnpm db:push` to create tables
3. Restart the dev server

### Authentication Not Working

1. Verify `BETTER_AUTH_SECRET` is set in `.env.local`
2. Make sure the database tables were created (`pnpm db:push`)
3. Check that Better Auth URL matches your dev server URL

### Type Errors in Routes

If you see TypeScript errors in route files:
1. Make sure you've run `pnpm dev` at least once
2. TanStack Router generates type definitions on startup
3. Check that `routeTree.gen.ts` exists in `src/`

## Production Deployment

Before deploying to production:

1. **Set Environment Variables:**
   ```env
   DATABASE_URL=your_production_database_url
   BETTER_AUTH_SECRET=your_production_secret
   BETTER_AUTH_URL=https://yourdomain.com
   ```

2. **Run Migrations:**
   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

3. **Build and Deploy:**
   ```bash
   pnpm build
   pnpm deploy
   ```

## Next Steps

- Explore the demo pages at `/demo`
- Read the [README.md](./README.md) for detailed package documentation
- Check out individual package documentation (links in README)
- Start building your application!

## Need Help?

- [TanStack Discord](https://discord.com/invite/WrRKjPJ)
- [Better Auth Docs](https://www.better-auth.com)
- [Drizzle Discord](https://discord.gg/drizzle)
- [Neon Docs](https://neon.tech/docs)
