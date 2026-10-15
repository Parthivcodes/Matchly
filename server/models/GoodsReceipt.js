const mongoose = require('mongoose');

const GRNLineSchema = new mongoose.Schema({
  poLineNumber: { type: Number, required: true },
  itemCode: { type: String, required: true },
  receivedQty: { type: Number, required: true },
  rejectedQty: { type: Number, default: 0.0 },
  rejectionNotes: { type: String }
});

const GoodsReceiptSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  poId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
  poNumber: { type: String, required: true },
  grnNumber: { type: String, required: true },
  receivedDate: { type: Date, default: Date.now },
  warehouseLocation: { type: String, default: 'MAIN DOCK' },
  receivedBy: { type: String, default: 'Carlos Mendoza' },
  lines: [GRNLineSchema]
}, { timestamps: true });

GoodsReceiptSchema.index({ tenantId: 1, grnNumber: 1 }, { unique: true });

module.exports = mongoose.model('GoodsReceipt', GoodsReceiptSchema);
