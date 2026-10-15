const mongoose = require('mongoose');

const VendorSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  vendorCode: { type: String, required: true },
  name: { type: String, required: true },
  taxId: { type: String },
  contactEmail: { type: String },
  currency: { type: String, default: 'USD' },
  paymentTermsDays: { type: Number, default: 30 },
  glAccountCode: { type: String, default: '5000-COGS' },
  trustScore: { type: Number, default: 100.0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

VendorSchema.index({ tenantId: 1, vendorCode: 1 }, { unique: true });

module.exports = mongoose.model('Vendor', VendorSchema);
