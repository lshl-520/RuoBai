import { pool } from './db.js';

await pool.execute('DELETE FROM sessions');
console.log('✓ All sessions cleared');

await pool.end();
