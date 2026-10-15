const mongoose = require('mongoose');

const ToleranceRuleSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
  category: { type: String, default: null },
  priceTolerancePct: { type: Number, default: 1.50 },
  priceToleranceAbs: { type: Number, default: 5.00 },
  qtyTolerancePct: { type: Number, default: 0.00 },
  qtyToleranceAbs: { type: Number, default: 0.00 },
  isStricterRule: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('ToleranceRule', ToleranceRuleSchema);
