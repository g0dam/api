const fs = require('fs');
const path = require('path');
const { initializePool, close } = require('../src/config/database');

async function run() {
  const db = initializePool();
  if (!db) throw new Error('DATABASE_URL is required');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await db.query(sql);
  console.log('Database migration completed');
  await close();
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
