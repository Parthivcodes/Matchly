const mongoose = require('mongoose');

let mongoServer = null;

let connectionPromise = null;

async function openConnection() {
  const uri = process.env.MONGODB_URI;

  if (uri) {
    console.log('Connecting to external MongoDB...');
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 });
    console.log('MongoDB connected successfully.');
    return;
  }

  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('MONGODB_URI is required for deployed environments');
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

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (!connectionPromise) connectionPromise = openConnection().catch(error => {
    connectionPromise = null;
    throw error;
  });
  return connectionPromise;
}

async function closeDB() {
  connectionPromise = null;
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
}

module.exports = { connectDB, closeDB };
