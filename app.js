require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const { connectDB } = require('./server/config/db');

const authRoutes = require('./server/routes/auth');
const invoiceRoutes = require('./server/routes/invoices');
const poRoutes = require('./server/routes/purchaseOrders');
const grnRoutes = require('./server/routes/goodsReceipts');
const exceptionRoutes = require('./server/routes/exceptions');
const vendorRoutes = require('./server/routes/vendors');
const analyticsRoutes = require('./server/routes/analytics');
const exportRoutes = require('./server/routes/exports');
const databaseRoutes = require('./server/routes/database');

const app = express();


// Middleware
app.use(cors());
app.use(express.json());

// Connect lazily: static pages stay available even if the database is unavailable.
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/v1', async (req, res, next) => {
  try { await connectDB(); next(); }
  catch (error) {
    console.error('Database connection unavailable:', error.name);
    res.status(503).json({ detail: 'Database unavailable. Configure MONGODB_URI in the deployment environment.' });
  }
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/invoices', invoiceRoutes);
app.use('/api/v1/purchase-orders', poRoutes);
app.use('/api/v1/goods-receipts', grnRoutes);
app.use('/api/v1/exceptions', exceptionRoutes);
app.use('/api/v1/vendors', vendorRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/exports', exportRoutes);
app.use('/api/v1/database', databaseRoutes);

// Static frontend serving
const frontendDir = path.join(__dirname, 'frontend');
app.use('/static', express.static(frontendDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(frontendDir, 'dashboard.html'));
});


module.exports = app;
