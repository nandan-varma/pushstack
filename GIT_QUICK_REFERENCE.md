# Git Operations Quick Reference

## Clone a Repository

### Public Repository
```bash
git clone http://localhost:3001/api/git/{username}/{repo-name}.git
```

### Private Repository
```bash
# You'll be prompted for username and password
git clone http://localhost:3001/api/git/{username}/{repo-name}.git

# Or embed credentials (not recommended)
git clone http://{username}:{password}@localhost:3001/api/git/{username}/{repo-name}.git
```

## Push to Repository

```bash
cd your-repo
git add .
git commit -m "Your commit message"
git push origin main
```

## Common Git Commands

### Initialize New Repository
```bash
mkdir my-project
cd my-project
git init
echo "# My Project" > README.md
git add README.md
git commit -m "Initial commit"
git remote add origin http://localhost:3001/api/git/{username}/{repo-name}.git
git push -u origin main
```

### Push Existing Repository
```bash
cd existing-repo
git remote add origin http://localhost:3001/api/git/{username}/{repo-name}.git
git push -u origin main
```

### Import Repository
```bash
git clone --bare https://github.com/user/repo.git
cd repo.git
git push --mirror http://localhost:3001/api/git/{username}/{repo-name}.git
```

## Authentication

### Credential Helper
To avoid entering credentials every time:

```bash
# Store credentials (plaintext - use with caution)
git config --global credential.helper store

# Cache credentials for 1 hour
git config --global credential.helper 'cache --timeout=3600'

# Use macOS Keychain
git config --global credential.helper osxkeychain

# Use Windows Credential Manager
git config --global credential.helper manager
```

### First Push
```bash
# You'll be prompted for:
# Username: your-email@example.com
# Password: your-password
git push origin main
```

## Troubleshooting

### Authentication Failed
```bash
# Clear cached credentials
git credential-cache exit

# Or remove stored credentials
rm ~/.git-credentials

# Try again
git push origin main
```

### Repository Not Found
- Verify the repository exists in the web UI
- Check the owner username is correct
- Check the repository name spelling

### Permission Denied
- Verify you have write access to the repository
- Check if you're pushing to the correct branch
- Ensure you're authenticated as the repo owner or collaborator

## Production URLs

When deployed to production, replace:
- `http://localhost:3001` → `https://your-domain.com`

Always use HTTPS in production for security.
