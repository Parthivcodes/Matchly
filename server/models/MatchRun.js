const mongoose = require('mongoose');

const MatchLineResultSchema = new mongoose.Schema({
  invoiceLineId: { type: String, required: true },
  poLineNumber: { type: Number },
  itemCode: { type: String },
  isMatched: { type: Boolean, required: true },
  usedTolerance: { type: Boolean, default: false },
  billableQty: { type: Number, required: true },
  invoicedQty: { type: Number, required: true },
  qtyVariance: { type: Number, required: true },
  poUnitPrice: { type: Number, required: true },
  invoicedUnitPrice: { type: Number, required: true },
  priceVariance: { type: Number, required: true },
  exceptionCode: { type: String },
  message: { type: String }
});

const MatchRunSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  poId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  status: { 
    type: String, 
    enum: ['PENDING', 'MATCHED_EXACT', 'MATCHED_TOLERANCE', 'EXCEPTION'],
    required: true 
  },
  rulesApplied: { type: mongoose.Schema.Types.Mixed },
  totalPriceVariance: { type: Number, default: 0.0 },
  totalQtyVariance: { type: Number, default: 0.0 },
  executedAt: { type: Date, default: Date.now },
  lineResults: [MatchLineResultSchema]
});

module.exports = mongoose.model('MatchRun', MatchRunSchema);
