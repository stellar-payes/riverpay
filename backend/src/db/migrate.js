import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
const schema = await readFile(schemaPath, 'utf8');

await pool.query(schema);
console.log('Migration applied.');
await pool.end();
