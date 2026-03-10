# Git Implementation Test Plan

## Manual Testing Checklist

After deployment, verify these core git operations work correctly:

### 1. Repository Creation
- [ ] Create a new repository
- [ ] Verify `main` branch is created
- [ ] Check initial README.md commit exists
- [ ] Confirm repository appears in database
- [ ] Verify git directory is created on filesystem

### 2. File Operations
- [ ] Upload a new file
- [ ] View file content
- [ ] Download file
- [ ] Delete file
- [ ] Upload multiple files in one commit

### 3. Branch Operations
- [ ] List branches
- [ ] Create new branch from main
- [ ] Create branch from specific commit
- [ ] Delete branch
- [ ] Verify cannot delete default branch

### 4. Commit Operations
- [ ] View commit history
- [ ] View commit details
- [ ] View commit diff
- [ ] Verify author information
- [ ] Check commit timestamps

### 5. Directory Operations
- [ ] List files in root directory
- [ ] List files in subdirectory
- [ ] Create nested directories with upload
- [ ] Navigate directory tree

### 6. Diff Operations
- [ ] View diff for single commit
- [ ] Compare two branches
- [ ] View additions and deletions
- [ ] Check line numbers match

### 7. Pull Request Flow
- [ ] Create pull request
- [ ] View PR diff
- [ ] Check for conflicts
- [ ] Merge pull request
- [ ] Verify merge commit created

### 8. Repository Management
- [ ] Clone existing repository (if enabled)
- [ ] View repository disk usage
- [ ] Update repository metadata
- [ ] Delete repository
- [ ] Verify git directory is removed

## Automated Test Commands

### Run Production Validation
```bash
pnpm test src/server/__tests__/production-validation.test.ts --run
```

### Run All Tests
```bash
pnpm test --run
```

### Run E2E Tests
```bash
pnpm test:e2e
```

### Check Build
```bash
pnpm build
```

### Check Types
```bash
pnpm tsc --noEmit
```

## Performance Testing

### Small Repository (< 100 files)
- Commit creation: < 1s
- File listing: < 100ms
- Diff generation: < 200ms
- Branch operations: < 100ms

### Medium Repository (100-1000 files)
- Commit creation: < 2s
- File listing: < 300ms
- Diff generation: < 500ms
- Branch operations: < 200ms

### Large Repository (> 1000 files)
- Monitor performance
- May need optimization
- Consider pagination

## Error Scenarios to Test

- [ ] Upload to non-existent repository
- [ ] Upload to non-existent branch
- [ ] Create duplicate branch name
- [ ] Delete default branch (should fail)
- [ ] Access non-existent file
- [ ] Access non-existent commit
- [ ] Merge with conflicts
- [ ] Invalid git operations

## Security Testing

- [ ] Verify authentication required
- [ ] Test permission checks (owner vs collaborator)
- [ ] Verify rate limiting (if implemented)
- [ ] Test file size limits
- [ ] Verify path traversal protection
- [ ] Test malicious file names

## Browser Compatibility

Test UI in:
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari
- [ ] Mobile browsers

## Load Testing (Optional)

For production deployment:
- Concurrent repository operations
- Multiple file uploads
- Large file handling
- Database connection pooling

## Monitoring Checklist

After deployment, set up:
- [ ] Error tracking (Sentry, etc.)
- [ ] Performance monitoring (APM)
- [ ] Disk usage alerts
- [ ] Database query monitoring
- [ ] Log aggregation
- [ ] Uptime monitoring

## Rollback Plan

If issues are found:

1. **Immediate:** Revert deployment
2. **Review:** Check error logs
3. **Fix:** Address issues locally
4. **Test:** Verify fixes
5. **Deploy:** Redeploy with fixes

## Success Criteria

✅ All manual tests pass
✅ No console errors in browser
✅ No server errors in logs
✅ Performance within acceptable limits
✅ Database operations complete successfully
✅ Git operations create valid commits
✅ Repository files accessible via git CLI (optional verification)

---

**Last Updated:** March 10, 2026  
**Status:** Ready for Testing
