# Authentication System Documentation

## Overview

This document outlines the authentication system implementation for PushStack, including security improvements, features, and production considerations.

## Technologies Used

- **Better Auth** v1.5.3 - Modern authentication library
- **Drizzle ORM** - Database adapter
- **TanStack Start** - Framework integration with cookie handling
- **PostgreSQL** - Database for storing user accounts and sessions

## Security Features Implemented

### 1. Core Configuration (`src/lib/auth.ts`)

#### ✅ Secret Key Management
- Configured `BETTER_AUTH_SECRET` for JWT signing and session encryption
- Requires minimum 32-character secret in production
- Environment variable based for security

#### ✅ Base URL Configuration
- Set `baseURL` for proper OAuth redirects and cookie settings
- Supports both development and production environments

#### ✅ Trusted Origins
- Configured `trustedOrigins` for CORS protection
- Prevents unauthorized cross-origin requests

#### ✅ Session Management
- **Session expiry**: 7 days
- **Update age**: 1 day (renews session token)
- **Cookie cache**: 5 minutes for performance
- **Cookie prefix**: 'pushstack' for namespace isolation

#### ✅ Secure Cookies
- `useSecureCookies` enabled in production (HTTPS only)
- `httpOnly` cookies prevent XSS attacks
- `sameSite` protection against CSRF
- Cross-subdomain cookies disabled by default

### 2. Password Security

#### ✅ Password Requirements
- Minimum 8 characters enforced both client and server-side
- Email + password authentication enabled
- Password hashing handled by Better Auth (bcrypt)

#### ✅ Email Verification
- Currently disabled (`requireEmailVerification: false`)
- **TODO**: Enable when email service is configured

### 3. Route Protection

All protected routes use `beforeLoad` lifecycle with session checks:
- `/dashboard` - User dashboard
- `/repositories` - Repository listing
- `/repositories/new` - Create repository
- `/repo/$owner/$name` - Repository pages

#### Redirect Flow
- Unauthenticated users → `/auth/login`
- Authenticated users accessing `/auth/*` → `/dashboard`

### 4. Client-Side Integration

#### Header Component (`src/integrations/better-auth/header-user.tsx`)
- Real-time session state with `authClient.useSession()`
- Sign-out with automatic redirect to home
- Loading states for better UX
- Avatar display with fallback to initials

#### Auth Pages
- **Login** (`/auth/login`) - with "forgot password" link
- **Register** (`/auth/register`) - with password confirmation
- **Forgot Password** (`/auth/forgot-password`) - UI ready, needs email service

#### Error Handling
- Callback-based error handling with Better Auth
- User-friendly error messages
- Loading states during authentication
- Form validation (client-side)

## Environment Variables

Required in `.env`:

```bash
# Database
DATABASE_URL=postgresql://...
DATABASE_URL_POOLER=postgresql://...

# Better Auth
BETTER_AUTH_SECRET=your-secret-key-change-in-production-min-32-chars
BETTER_AUTH_URL=http://localhost:3000  # Change to your production URL
```

### Generating Secrets

```bash
# Generate a secure random secret (macOS/Linux)
openssl rand -base64 32
```

## Database Schema

Better Auth tables (defined in `src/db/schema.ts`):
- `user` - User accounts with email, name, image
- `session` - Active sessions with expiry, IP, user agent
- `account` - OAuth providers and password storage
- `verification` - Email verification tokens (when enabled)

## Server Functions Pattern

All server functions in this project follow TanStack Start's pattern:

```ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// Define your schema
const mySchema = z.object({
  title: z.string(),
  description: z.string().optional(),
})

// Create server function with validation
export const myServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => mySchema.parse(data))
  .handler(async ({ data }) => {
    // `data` is fully typed based on your schema
    // Perform server-only operations here
    return { success: true }
  })
```

**Key Points:**
- Use `.inputValidator()` (not `.validator()`) for input validation
- The validator receives unknown data and should parse/validate it
- Return the validated data from the validator
- The handler receives the validated, typed data
- Server functions can be called from client code as RPC

## Authentication Flow

### Server-Side Session Checking

Session checks use `createServerFn` to wrap server-only code as RPC functions:

```ts
// In each route file
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '../lib/auth'

const getAuthSession = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = getRequestHeaders()
  return await auth.api.getSession({ headers })
})

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    const session = await getAuthSession()
    
    if (!session?.user) {
      throw redirect({ to: '/auth/login' })
    }
    
    return { user: session.user }
  },
})
```

**Why this pattern?**
- `getRequestHeaders()` and `auth.api.getSession()` are server-only
- `beforeLoad` runs on both client (navigation) and server (SSR)  
- `createServerFn` creates an RPC bridge that works from both environments
- Avoids import protection violations

### Registration Flow
1. User fills registration form
2. Client validates password match and length
3. `authClient.signUp.email()` called with callbacks
4. Better Auth creates user and session with proper headers
5. User redirected to dashboard
6. Session cookie set automatically via `tanstackStartCookies` plugin

### Login Flow
1. User enters credentials
2. `authClient.signIn.email()` called with callbacks
3. Better Auth validates credentials with proper headers
4. Session created and cookie set
5. User redirected to dashboard

### Logout Flow
1. User clicks "Sign out"
2. `authClient.signOut()` called
3. Session destroyed on server
4. Cookie cleared
5. User redirected to home

### Protected Route Access
1. Server function created with `createServerFn()` wraps `getRequestHeaders()` call
2. Session checked from cookies in `beforeLoad` by calling the server function
3. Works on both client navigation and server SSR
4. Valid session → continue to route
5. Invalid/missing session → redirect to login

## Security Best Practices Implemented

### ✅ Implemented
1. [x] Secret key for JWT signing
2. [x] Secure cookie configuration
3. [x] CSRF protection (SameSite cookies)
4. [x] XSS protection (httpOnly cookies)
5. [x] Session expiry and rotation
6. [x] Password minimum length
7. [x] Route-level authentication
8. [x] Error handling without leaking info
9. [x] HTTPS cookies in production
10. [x] Trusted origins configuration

### ⚠️ Recommended (Not Yet Implemented)

1. **Email Verification**
   - Enable in production
   - Requires email service (SendGrid, Resend, etc.)
   - Set `requireEmailVerification: true`

2. **Rate Limiting**
   - Add to prevent brute force attacks
   - Recommended: 5 failed attempts per 15 minutes
   - Can use Cloudflare, Upstash Rate Limit, or custom middleware

3. **Password Reset**
   - UI created (`/auth/forgot-password`)
   - Requires email service configuration
   - Uncomment implementation when ready

4. **Two-Factor Authentication (2FA)**
   - Better Auth supports TOTP
   - Add `twoFactor` plugin when needed

5. **OAuth Providers**
   - GitHub, Google, etc.
   - Add providers to Better Auth config
   - Requires client ID/secret for each provider

6. **Audit Logging**
   - Log authentication events
   - Track failed login attempts
   - Monitor suspicious activity

7. **Password Strength Meter**
   - Add client-side validation
   - Use libraries like zxcvbn

8. **Session Management Dashboard**
   - Allow users to view/revoke active sessions
   - Show device information

## Known Limitations

1. **No Rate Limiting**
   - Vulnerable to brute force attacks
   - Should be added before production

2. **Basic Password Policy**
   - Only length requirement (8 chars)
   - Consider adding complexity requirements

3. **No Account Recovery**
   - Users can't recover locked accounts
   - Add support ticket system or admin panel

4. **Email Service Not Configured**
   - Email verification disabled
   - Password reset non-functional
   - Account recovery requires manual intervention

## Testing Checklist

- [x] User can register with valid credentials
- [x] User cannot register with weak password
- [x] User cannot register with mismatched passwords
- [x] User can login with correct credentials
- [x] User cannot login with incorrect credentials
- [x] User can logout successfully
- [x] Protected routes redirect to login when not authenticated
- [x] Auth routes redirect to dashboard when authenticated
- [x] Session persists across browser refresh
- [x] Build completes successfully without errors
- [ ] Session expires after 7 days
- [ ] Session token rotates after 1 day
- [ ] Email verification works (when enabled)
- [ ] Password reset works (when enabled)

## Production Deployment Checklist

### Before Deploying

1. **Environment Variables**
   - [ ] Set `BETTER_AUTH_SECRET` to a random 32+ character string
   - [ ] Set `BETTER_AUTH_URL` to production domain
   - [ ] Set `NODE_ENV=production`

2. **Database**
   - [ ] Run migrations: `npm run db:migrate`
   - [ ] Verify all auth tables exist
   - [ ] Set up database backups

3. **Security**
   - [ ] Enable HTTPS on production domain
   - [ ] Configure Content Security Policy headers
   - [ ] Set up rate limiting
   - [ ] Enable email verification

4. **Monitoring**
   - [ ] Set up error tracking (Sentry, etc.)
   - [ ] Monitor authentication metrics
   - [ ] Set up alerts for failed logins

5. **Email Service** (Optional but Recommended)
   - [ ] Choose provider (SendGrid, Resend, etc.)
   - [ ] Configure SMTP settings
   - [ ] Enable email verification
   - [ ] Enable password reset

### After Deploying

1. **Manual Testing**
   - [ ] Test registration flow
   - [ ] Test login flow
   - [ ] Test logout flow
   - [ ] Test session persistence
   - [ ] Test password reset (if enabled)

2. **Security Testing**
   - [ ] Verify secure cookies are set
   - [ ] Test CSRF protection
   - [ ] Attempt SQL injection
   - [ ] Test rate limiting

## Troubleshooting

### Issue: "Unaut`createServerFn` for session checks with proper request headers
- Check session cookie is being sent (browser DevTools)
- Verify `BETTER_AUTH_SECRET` matches between server and client
- Verify `BETTER_AUTH_SECRET` matches
- Check database session hasn't expired

### Issue: Login/Register not working
- ✅ Fixed: Auth now reads cookies correctly from request headers
- Check database connection
- Verify Better Auth tables exist
- Check browser console for errors
- Verify `BETTER_AUTH_URL` is correct

### Issue: `createServerFn(...).validator is not a function`
- ✅ Fixed: Changed all `.validator()` to `.inputValidator()`
- TanStack Start uses `.inputValidator()` for validating input data
- Example:
  ```ts
  export const createPost = createServerFn({ method: "POST" })
    .inputValidator((data: { title: string }) => data)
    .handler(async ({ data }) => {
      // data is validated and typed
    })
  ```

### Issue: Import protection errors during build
- ✅ Fixed: Wrapped server-only code in `createServerFn()` RPC bridges
- Don't import `.server.ts` files directly into routes
- Don't import `getRequestHeaders()` directly in client code
- Use `createServerFn` to create RPC functions that can be called from anywhere
- Check cookie is being set (browser DevTools)
- Verify cookie domain matches
- Check `sameSite` cookie policy with your setup

### Issue: Redirect loop
- Check `beforeLoad` logic in routes
- Verify session check isn't failing silently
- Check for conflicting redirects

## Additional Resources

- [Better Auth Documentation](https://www.better-auth.com/)
- [TanStack Start Auth Guide](https://tanstack.com/start/latest/docs/authentication)
- [OWASP Authentication Guidelines](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

## Support

For issues or questions:
1. Check this documentation
2. Review Better Auth docs
3. Check GitHub issues
4. Contact development team
