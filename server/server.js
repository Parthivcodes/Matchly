require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const { connectDB } = require('./config/db');
const { seedMernDatabase } = require('./seed');

const authRoutes = require('./routes/auth');
const invoiceRoutes = require('./routes/invoices');
const poRoutes = require('./routes/purchaseOrders');
const grnRoutes = require('./routes/goodsReceipts');
const exceptionRoutes = require('./routes/exceptions');
const vendorRoutes = require('./routes/vendors');
const analyticsRoutes = require('./routes/analytics');
const exportRoutes = require('./routes/exports');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/invoices', invoiceRoutes);
app.use('/api/v1/purchase-orders', poRoutes);
app.use('/api/v1/goods-receipts', grnRoutes);
app.use('/api/v1/exceptions', exceptionRoutes);
app.use('/api/v1/vendors', vendorRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/exports', exportRoutes);

// Static frontend serving
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use('/static', express.static(frontendDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Start Server
async function startServer() {
  try {
    await connectDB();
    await seedMernDatabase();

    app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`Matchly MERN Server running on http://127.0.0.1:${PORT}`);
      console.log(`Tech Stack: MongoDB + Express.js + React/Vanilla UI + Node.js`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('Failed to start MERN server:', err);
    process.exit(1);
  }
}

startServer();
