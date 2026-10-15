const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  email: { type: String, required: true },
  passwordHash: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  role: { 
    type: String, 
    enum: ['ADMIN', 'FINANCE_CONTROLLER', 'AP_CLERK', 'PROCUREMENT', 'WAREHOUSE', 'VIEWER'],
    default: 'AP_CLERK' 
  },
  isActive: { type: Boolean, default: true },
  lastLoginAt: { type: Date }
}, { timestamps: true });

UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('User', UserSchema);
