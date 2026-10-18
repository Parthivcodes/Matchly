const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { seedMernDatabase } = require('../seed');

// POST /api/v1/database/clear - Wipes all collections to remove static/demo data
router.post('/clear', async (req, res) => {
  try {
    const collections = mongoose.connection.collections;
    const cleared = [];
    for (const key in collections) {
      await collections[key].deleteMany({});
      cleared.push(key);
    }
    res.json({ success: true, message: 'Database successfully cleared. All static and demo records removed.', clearedCollections: cleared });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/database/seed - Seeds demo data on demand
router.post('/seed', async (req, res) => {
  try {
    const tenantId = await seedMernDatabase();
    res.json({ success: true, message: 'Database successfully seeded with demo data.', tenantId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
