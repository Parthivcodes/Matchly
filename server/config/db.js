const mongoose = require('mongoose');

let mongoServer = null;

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (uri) {
    console.log(`Connecting to external MongoDB at ${uri}...`);
    await mongoose.connect(uri);
    console.log('MongoDB connected successfully.');
    return;
  }

  // Fallback to local MongoDB or MongoMemoryServer
  try {
    console.log('Attempting connection to local mongodb://127.0.0.1:27017/matchly...');
    await mongoose.connect('mongodb://127.0.0.1:27017/matchly', {
      serverSelectionTimeoutMS: 2000
    });
    console.log('Connected to local MongoDB.');
  } catch (err) {
    console.log('Local MongoDB not running. Launching in-memory MongoDB server...');
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongoServer = await MongoMemoryServer.create();
    const memoryUri = mongoServer.getUri();
    await mongoose.connect(memoryUri);
    console.log(`Connected to in-memory MongoDB at ${memoryUri}`);
  }
}

async function closeDB() {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
}

module.exports = { connectDB, closeDB };
