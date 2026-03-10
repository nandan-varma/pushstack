import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'

import * as schema from './schema.ts'

// Create a Neon HTTP client for serverless environments
const sql = neon(process.env.DATABASE_URL!)

// Initialize Drizzle with the Neon client
export const db = drizzle(sql, { schema })
