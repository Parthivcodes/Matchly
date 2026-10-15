const mongoose = require('mongoose');

const POLineSchema = new mongoose.Schema({
  lineNumber: { type: Number, required: true },
  itemCode: { type: String, required: true },
  description: { type: String, required: true },
  orderedQty: { type: Number, required: true },
  uom: { type: String, default: 'EA' },
  unitPrice: { type: Number, required: true },
  taxRatePct: { type: Number, default: 0.0 },
  lineTotal: { type: Number, required: true }
});

const PurchaseOrderSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
  poNumber: { type: String, required: true },
  orderDate: { type: Date, default: Date.now },
  currency: { type: String, default: 'USD' },
  totalAmount: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['OPEN', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED'],
    default: 'OPEN' 
  },
  lines: [POLineSchema]
}, { timestamps: true });

PurchaseOrderSchema.index({ tenantId: 1, poNumber: 1 }, { unique: true });

module.exports = mongoose.model('PurchaseOrder', PurchaseOrderSchema);
