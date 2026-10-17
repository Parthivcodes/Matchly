require('dotenv').config();
const { connectDB, closeDB } = require('../server/config/db');
const { seedMernDatabase } = require('../server/seed');
(async () => {
  try { await connectDB(); await seedMernDatabase(); }
  catch (error) { console.error('Seeding failed:', error.name); process.exitCode = 1; }
  finally { await closeDB(); }
})();
