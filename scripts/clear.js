require('dotenv').config();
const { connectDB, closeDB } = require('../server/config/db');
const mongoose = require('mongoose');

async function clearDatabase() {
  try {
    await connectDB();
    console.log('Connected to MongoDB. Purging all collections...');
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
      console.log(`Cleared collection: ${key}`);
    }
    console.log('Database successfully cleared! All static and demo data removed.');
  } catch (error) {
    console.error('Failed to clear database:', error.message);
    process.exitCode = 1;
  } finally {
    await closeDB();
  }
}

if (require.main === module) {
  clearDatabase();
}

module.exports = { clearDatabase };
