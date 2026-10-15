const express = require('express');
const router = express.Router();
const Vendor = require('../models/Vendor');

router.get('/', async (req, res) => {
  try {
    const vendors = await Vendor.find();
    res.json(vendors.map(v => ({
      id: v._id,
      vendor_code: v.vendorCode,
      name: v.name,
      tax_id: v.taxId,
      currency: v.currency,
      payment_terms_days: v.paymentTermsDays,
      trust_score: v.trustScore,
      is_active: v.isActive
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
