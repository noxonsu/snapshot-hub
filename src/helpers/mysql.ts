import { Pool } from 'pg';

const connectionLimit = parseInt(process.env.CONNECTION_LIMIT || '25');
console.log('Connection limit', connectionLimit);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: connectionLimit,
  connectionTimeoutMillis: 30000
});

// Wrapper to provide queryAsync interface compatible with existing code
const db = {
  queryAsync: async (sql: string, params?: any[]): Promise<any> => {
    // Convert MySQL ? placeholders to PostgreSQL $N placeholders
    let paramIndex = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
    const result = await pool.query(pgSql, params);
    return result.rows;
  },
  pool
};

export default db;
