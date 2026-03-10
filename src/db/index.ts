import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'

import * as schema from './schema.ts'

// Verify DATABASE_URL is configured
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Create a Neon HTTP client for serverless environments
const sql = neon(process.env.DATABASE_URL)

// Initialize Drizzle with the Neon client
export const db = drizzle(sql, { 
  schema,
  logger: process.env.NODE_ENV === 'development' ? {
    logQuery: (query, params) => {
      console.log('Query:', query);
      console.log('Params:', params);
    }
  } : undefined
})
