const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  baseCurrency: { type: String, default: 'USD' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Tenant', TenantSchema);
