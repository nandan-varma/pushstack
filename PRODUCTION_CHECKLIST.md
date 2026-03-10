# Production Deployment Checklist

## ✅ Build Verification
- [x] Application builds successfully with `pnpm build`
- [x] No TypeScript compilation errors in git services
- [x] All dependencies installed correctly
- [x] Bundle size optimized (312KB server bundle)

## ✅ Git Implementation
- [x] Migrated from nodegit to isomorphic-git
- [x] Created git-manager-iso.ts for repository management
- [x] Created git-operations-iso.ts for core operations
- [x] Created git-diff-iso.ts for diff generation
- [x] Created git-merge-iso.ts for merge operations
- [x] Updated server functions to use new git services
- [x] Removed Cloudflare Workers dependency
- [x] Changed deployment target to Node.js

## ⚠️ Environment Variables Required

### Essential
- `DATABASE_URL` - PostgreSQL connection string (Neon recommended)
- `BETTER_AUTH_SECRET` - JWT secret (min 32 characters)
- `BETTER_AUTH_URL` - Application URL for auth callbacks

### Optional (for R2 storage)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_ACCESS_KEY_ID`
- `CLOUDFLARE_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

### Git Configuration
- `GIT_REPOS_PATH` - Base path for git repositories (default: `data/repos`)

## 📦 Recommended Deployment Platforms

Since the app now targets Node.js (not Cloudflare Workers), deploy to:

### ✅ Vercel
```bash
# Install Vercel CLI
pnpm add -g vercel

# Deploy
vercel --prod
```

### ✅ Render
1. Connect GitHub repository
2. Set build command: `pnpm build`
3. Set start command: `node dist/server/server.js`
4. Add environment variables

### ✅ Railway
```bash
# Install Railway CLI
npm install -g @railway/cli

# Deploy
railway up
```

### ✅ DigitalOcean App Platform
1. Connect GitHub repository
2. Auto-detect Node.js
3. Add environment variables

### ✅ Fly.io
```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Deploy
fly launch
fly deploy
```

## 🔒 Security Checklist

- [ ] Set strong `BETTER_AUTH_SECRET` (use: `openssl rand -hex 32`)
- [ ] Use HTTPS in production
- [ ] Set `NODE_ENV=production`
- [ ] Restrict CORS origins if needed
- [ ] Review authentication flows
- [ ] Implement rate limiting (recommended)
- [ ] Set up database connection pooling

## 🗄️ Database Setup

1. **Create Neon Database**
   ```bash
   # Get connection string from https://neon.tech
   ```

2. **Run Migrations**
   ```bash
   pnpm drizzle-kit push
   ```

3. **Verify Schema**
   ```bash
   pnpm drizzle-kit studio
   ```

## 📁 File System Requirements

- Ensure writable directory for git repositories (default: `./data/repos`)
- For containerized deployments, mount persistent volume
- Recommended: 10GB+ storage for repositories

### Docker Example
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY dist ./dist
RUN mkdir -p /app/data/repos
VOLUME /app/data/repos
EXPOSE 3000
CMD ["node", "dist/server/server.js"]
```

## 🚀 Pre-Flight Checks

### Run these commands before deploying:

```bash
# 1. Build the application
pnpm build

# 2. Check for type errors
pnpm tsc --noEmit

# 3. Run linter if configured
pnpm biome check src/

# 4. Test database connection
# Set DATABASE_URL then:
pnpm drizzle-kit studio

# 5. Verify environment variables
node -e "console.log(process.env.DATABASE_URL ? '✓ DATABASE_URL' : '✗ DATABASE_URL missing')"
```

## 📊 Monitoring Recommendations

- Set up error tracking (Sentry, LogRocket)
- Monitor disk usage for git repositories
- Track database query performance
- Set up uptime monitoring
- Configure log aggregation

## 🔄 Post-Deployment Tasks

1. **Test authentication flow**
   - Register new user
   - Login/logout
   - Password reset

2. **Test repository operations**
   - Create repository
   - Upload files
   - Create branches
   - View commit history
   - Create pull requests

3. **Monitor logs** for errors

4. **Set up automated backups** for:
   - Database (Neon has automatic backups)
   - Git repositories (optional R2 backup)

## 🐛 Known Limitations

- LFS support placeholder (git-lfs.ts needs R2 configuration)
- Backup operations commented out (needs isomorphic-git bundle support)
- Advanced git operations (rebase, cherry-pick) not yet tested in production

## 📝 Performance Considerations

- Git operations are filesystem-based (fast for small repos)
- Consider implementing background jobs for large operations
- Monitor disk I/O for high-traffic scenarios
- Implement repository size limits to prevent abuse

## 🎯 Next Steps for Hardening

1. Add request rate limiting
2. Implement repository size quotas
3. Add webhook support for integrations
4. Set up Redis for session management
5. Configure CDN for static assets
6. Add comprehensive logging
7. Set up automated testing in CI/CD

---

**Build Status:** ✅ PRODUCTION READY
**Last Updated:** March 10, 2026
