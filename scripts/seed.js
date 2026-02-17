const { queryOne, close } = require('../src/config/database');
const { generateApiKey, hashToken } = require('../src/utils/auth');

async function run() {
  const adminKey = generateApiKey();
  const hash = hashToken(adminKey);

  const admin = await queryOne(
    `INSERT INTO agents (name, display_name, description, api_key_hash, status, is_claimed, is_market_admin)
     VALUES ('market_admin', 'Market Admin', 'Admin for MoltMarket experiments', $1, 'active', true, true)
     ON CONFLICT (name)
     DO UPDATE SET is_market_admin = true
     RETURNING id, name`,
    [hash]
  );

  console.log('Seeded admin agent:', admin.name);
  console.log('Admin API key (save this):', adminKey);
  await close();
}

run().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
