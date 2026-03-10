# Git HTTP Protocol Testing Guide

## Implementation Complete ✅

The complete git HTTP protocol has been implemented using:
- **Vite middleware plugin** to handle /api/git/* requests
- **Native git commands** via child_process for pack protocol
- **HTTP Basic Auth** for authentication
- **Session-based auth** as fallback

## Architecture

### Files Created
1. **vite-plugin-git.ts** - Vite middleware that intercepts /api/git/* requests
2. **src/lib/git-url-parser.ts** - Parses git protocol URLs
3. **src/server/git-http-backend.ts** - Executes git commands for pack protocol
4. **src/server/git-auth.ts** - Authentication middleware (already existed)
5. **src/server/repositories.ts** - Added `findRepositoryByName()` helper

### Git Protocol Endpoints

All requests to `/api/git/` are handled by the Vite middleware plugin:

- `GET /api/git/{owner}/{repo}.git/info/refs?service=git-upload-pack` → Clone/Fetch discovery
- `POST /api/git/{owner}/{repo}.git/git-upload-pack` → Clone/Fetch transfer
- `GET /api/git/{owner}/{repo}.git/info/refs?service=git-receive-pack` → Push discovery
- `POST /api/git/{owner}/{repo}.git/git-receive-pack` → Push transfer

## Testing Instructions

### Prerequisites

1. **Dev server running** on port 3001 (or 3000)
2. **User account created** via web UI
3. **Repository created** via web UI (e.g., "tacoma")
4. **Git installed** locally

### Test 1: Clone Repository

```bash
# Clone a public repository
git clone http://localhost:3001/api/git/nandan/tacoma.git
cd tacoma

# Verify files
ls -la
cat README.md
```

**Expected result**: Repository clones successfully with all files

### Test 2: Push Changes

```bash
cd tacoma

# Make a change
echo "# Updated" >> README.md
git add README.md
git commit -m "Update README"

# Push (will prompt for credentials)
git push origin main
```

**Expected result**: 
- Prompts for username/password
- Uses HTTP Basic Auth
- Push succeeds and refs are updated

### Test 3: Authentication

```bash
# Try cloning a private repository without credentials
git clone http://localhost:3001/api/git/nandan/private-repo.git

# Should fail with 401 Unauthorized

# Clone with credentials embedded (not recommended for prod)
git clone http://username:password@localhost:3001/api/git/nandan/private-repo.git

# Or configure git credentials
git config --global credential.helper store
git clone http://localhost:3001/api/git/nandan/private-repo.git
# Enter credentials when prompted
```

### Test 4: Verify on Disk

```bash
# Check that bare repositories are created
ls -la .git-repos/nandan/

# Should see: tacoma.git/
```

### Test 5: End-to-End Workflow (from user's test case)

```bash
# Create a new local repository
mkdir test-repo
cd test-repo
git init
echo "# Test" > README.md
git add README.md
git commit -m "Initial commit"

# Add remote (after creating repo in web UI)
git remote add origin http://localhost:3001/api/git/nandan/test-repo.git

# Push to server
git push -u origin main

# Should succeed and create refs on server
```

## How It Works

### 1. Request Flow

```
Git client → http://localhost:3001/api/git/owner/repo.git/info/refs
            ↓
    Vite middleware (vite-plugin-git.ts)
            ↓
    Parse URL (git-url-parser.ts)
            ↓
    Find repository in database (repositories.ts)
            ↓
    Authenticate request (git-auth.ts)
            ↓
    Initialize bare repo if needed (git-http-backend.ts)
            ↓
    Execute git command (spawn git upload-pack/receive-pack)
            ↓
    Return response to git client
```

### 2. Repository Storage

- **Database**: Metadata (name, description, visibility, owner)
- **Filesystem**: `.git-repos/{owner}/{repo}.git/` - Bare git repository
- **R2**: Files are synced to R2 for web viewing (existing implementation)

### 3. Authentication

Three methods supported (in order of precedence):

1. **HTTP Basic Auth**: Username + password in Authorization header
2. **Session cookie**: Authenticated web session
3. **Personal Access Token** (future): Token in Authorization header

## Manual Testing with curl

### Test info/refs endpoint

```bash
# Public repository
curl -i "http://localhost:3001/api/git/nandan/tacoma.git/info/refs?service=git-upload-pack"

# Expected: 200 OK with git refs advertisement
# Content-Type: application/x-git-upload-pack-advertisement

# Private repository (with auth)
curl -i -u username:password "http://localhost:3001/api/git/nandan/private.git/info/refs?service=git-upload-pack"
```

### Test authentication

```bash
# No auth - should return 401
curl -i "http://localhost:3001/api/git/nandan/private.git/info/refs?service=git-upload-pack"
# Expected: 401 Unauthorized with WWW-Authenticate header

# With auth - should return 200
curl -i -u username:password "http://localhost:3001/api/git/nandan/private.git/info/refs?service=git-upload-pack"
# Expected: 200 OK with refs
```

## Troubleshooting

### Issue: "repository not found"
- Check repository exists in database
- Check owner username matches URL
- Check bare repo initialized: `ls .git-repos/{owner}/{repo}.git/`

### Issue: Authentication fails
- Verify credentials are correct
- Check session cookie if using web auth
- Check git is sending Authorization header: `GIT_CURL_VERBOSE=1 git clone ...`

### Issue: Push fails
- Check user has write permissions (owner or collaborator with write role)
- Verify receive-pack is enabled
- Check bare repo is properly initialized

### Issue: Clone succeeds but no files
- Check bare repo has commits: `git log --all --oneline` in bare repo
- Verify refs exist: `git show-ref` in bare repo
- Check if repository was created with initial commit

## Production Considerations

### Security
- [ ] **HTTPS only** - Never use HTTP in production
- [ ] **Personal Access Tokens** - Implement PAT support instead of passwords
- [ ] **Rate limiting** - Limit git operations per IP/user
- [ ] **Audit logging** - Log all push/pull operations

### Performance
- [ ] **Git caching** - Enable git pack caching
- [ ] **Connection pooling** - Reuse git processes
- [ ] **Compression** - Enable git protocol compression
- [ ] **Large file handling** - Implement Git LFS

### Storage
- [ ] **Repository size limits** - Set max repo size
- [ ] **Garbage collection** - Periodic `git gc` on bare repos
- [ ] **Backup strategy** - Backup .git-repos directory
- [ ] **Cleanup old repos** - Archive/delete inactive repos

### Monitoring
- [ ] **Metrics** - Track clone/push/pull counts
- [ ] **Error tracking** - Log git command failures
- [ ] **Performance monitoring** - Track git operation latency
- [ ] **Storage monitoring** - Alert on disk usage

## Next Steps

1. **Test thoroughly** - Run through all test scenarios above
2. **Personal Access Tokens** - Implement PAT generation and storage
3. **Git LFS** - Add large file support if needed
4. **Production deployment** - Deploy to Node.js environment with HTTPS
5. **Documentation** - Add user-facing git documentation to UI

## Files Modified

- ✅ `vite-plugin-git.ts` (created) - Vite middleware for git HTTP protocol
- ✅ `vite.config.ts` (modified) - Added gitHttpProtocol plugin
- ✅ `src/lib/git-url-parser.ts` (created) - Git URL parsing
- ✅ `src/server/git-http-backend.ts` (created) - Git command execution  
- ✅ `src/server/repositories.ts` (modified) - Added findRepositoryByName
- ✅ `.env.local` (modified) - Added GIT_REPOS_PATH
- ✅ `package.json` (modified) - Added node-git-server dependency

## Status

**Implementation**: ✅ Complete  
**Build**: ✅ Passing  
**Dev Server**: ✅ Running on port 3001  
**Ready for Testing**: ✅ Yes

---

**Next action**: Run test scenarios above to verify git operations work end-to-end.
