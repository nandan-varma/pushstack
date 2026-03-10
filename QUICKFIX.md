# 🔧 Quick Fix: DATABASE_URL Not Configured

## The Problem

You're seeing the error:
```
Failed query: select ... from "repositories" ...
```

This happens because the `DATABASE_URL` environment variable is not set.

## The Solution

### Step 1: Get a Database

1. Sign up for a free PostgreSQL database at **[Neon](https://neon.tech)** (recommended)
2. Create a new project
3. Copy the connection string (looks like: `postgresql://user:password@host/database`)

Alternatives to Neon:
- Supabase: https://supabase.com
- Railway: https://railway.app
- Local PostgreSQL

### Step 2: Configure Environment

Create `.env.local` in the project root:

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your database URL:

```env
# Required: Your PostgreSQL connection string
DATABASE_URL=postgresql://user:password@host/database

# Required: Generate with: pnpm dlx @better-auth/cli secret
BETTER_AUTH_SECRET=your-generated-secret-min-32-chars
BETTER_AUTH_URL=http://localhost:3000
```

### Step 3: Initialize Database

Push schema to database:

```bash
pnpm drizzle-kit push
```

### Step 4: Restart Your Dev Server

```bash
# Kill the existing server
lsof -ti:3000 | xargs kill -9 2>/dev/null

# Start fresh
pnpm dev
```

## Verify Configuration

You can verify your setup with:

```bash
# Check if DATABASE_URL is set
echo "DATABASE_URL is ${DATABASE_URL:+configured}${DATABASE_URL:-NOT SET}"
```

## Still Having Issues?

### Check Database Connection

```bash
# Using psql (if installed)
psql "$DATABASE_URL" -c "SELECT version();"
```

### Check Neon Dashboard

1. Go to https://console.neon.tech
2. Navigate to your project
3. Check "Connection Details"
4. Ensure your IP is allowed (usually auto-configured)

### Common Issues

1. **Connection string format**: Must start with `postgresql://`
2. **Quotes in .env**: Don't use quotes around the URL
3. **Spaces**: No spaces around the `=` sign
4. **File location**: `.env.local` must be in project root

## Next Steps

Once configured, try creating a repository again. The database query should work successfully.

---

For full setup instructions, see [SETUP.md](SETUP.md)
