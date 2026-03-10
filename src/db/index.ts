import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'

import * as schema from './schema.ts'

// Check if running on server or client
const isServer = typeof window === 'undefined'

// Verify DATABASE_URL is configured (only on server)
if (isServer && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Create a Neon HTTP client for serverless environments
// On client, use a dummy connection string (will never be used since db calls are server-only)
const connectionString = isServer 
  ? process.env.DATABASE_URL! 
  : 'postgresql://client@localhost/dummy'

const sql = neon(connectionString)

// Initialize Drizzle with the Neon client
export const db = drizzle(sql, { 
  schema,
  logger: isServer && process.env.NODE_ENV === 'development' ? {
    logQuery: (query, params) => {
      console.log('Query:', query);
      console.log('Params:', params);
    }
  } : undefined
})
