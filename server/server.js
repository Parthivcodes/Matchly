require('dotenv').config();
const app = require('../app');
const { connectDB } = require('./config/db');
const { seedMernDatabase } = require('./seed');
async function startServer() {
  await connectDB();
  if (process.env.SEED_DEMO_DATA === 'true') await seedMernDatabase();
  const port = process.env.PORT || 5000;
  return app.listen(port, () => console.log(`Matchly running on http://127.0.0.1:${port}`));
}
if (require.main === module) startServer().catch(error => {
  console.error('Failed to start Matchly:', error.name);
  process.exitCode = 1;
});
module.exports = { app, startServer };
