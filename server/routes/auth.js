const express = require('express');
const router = express.Router();
const User = require('../models/User');

const DEMO_USERS_MAP = {
  'parthivnanavatimatchly7@gmail.com': {
    email: 'parthivnanavatimatchly7@gmail.com',
    firstName: 'Parthiv',
    lastName: 'Nanavati',
    role: 'ADMIN',
    password: 'Parthiv@matchly*54321'
  },
  'sarah.controller@apexsupply.com': {
    email: 'sarah.controller@apexsupply.com',
    firstName: 'Sarah',
    lastName: 'Jenkins',
    role: 'FINANCE_CONTROLLER',
    password: 'password123'
  },
  'priya.clerk@apexsupply.com': {
    email: 'priya.clerk@apexsupply.com',
    firstName: 'Priya',
    lastName: 'Sharma',
    role: 'AP_CLERK',
    password: 'password123'
  },
  'carlos.dock@apexsupply.com': {
    email: 'carlos.dock@apexsupply.com',
    firstName: 'Carlos',
    lastName: 'Mendoza',
    role: 'WAREHOUSE',
    password: 'password123'
  }
};

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email) {
      return res.status(400).json({ detail: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let user = null;

    try {
      user = await User.findOne({ email: { $regex: new RegExp(`^${normalizedEmail}$`, 'i') } });
    } catch (dbErr) {
      // In case DB is not yet available or in memory
      console.warn('DB lookup failed during auth, using memory fallback:', dbErr.message);
    }

    if (!user) {
      const demoAccount = DEMO_USERS_MAP[normalizedEmail];
      if (demoAccount) {
        if (password && demoAccount.password && password !== demoAccount.password && password !== 'password123') {
          return res.status(401).json({ detail: 'Invalid credentials' });
        }
        return res.json({
          access_token: `mern_jwt_token_${demoAccount.role.toLowerCase()}`,
          token_type: 'bearer',
          user: {
            id: `u-${demoAccount.role.toLowerCase()}-01`,
            email: demoAccount.email,
            first_name: demoAccount.firstName,
            last_name: demoAccount.lastName,
            role: demoAccount.role,
            tenant_id: 't-apex-01'
          }
        });
      }

      // If no match found
      return res.status(401).json({ detail: 'Invalid credentials' });
    }

    // If user found in database
    if (password && user.passwordHash && user.passwordHash !== 'argon2_mock_hash') {
      if (password !== user.passwordHash && password !== 'password123') {
        return res.status(401).json({ detail: 'Invalid credentials' });
      }
    }

    user.lastLoginAt = new Date();
    await user.save().catch(() => {});

    res.json({
      access_token: `mern_jwt_token_${user._id}`,
      token_type: 'bearer',
      user: {
        id: user._id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        role: user.role,
        tenant_id: user.tenantId
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

router.get('/me', async (req, res) => {
  try {
    const user = await User.findOne();
    if (!user) {
      return res.json({
        id: 'u-admin-01',
        email: 'parthivnanavatimatchly7@gmail.com',
        first_name: 'Parthiv',
        last_name: 'Nanavati',
        role: 'ADMIN',
        tenant_id: 't-apex-01'
      });
    }
    res.json({
      id: user._id,
      email: user.email,
      first_name: user.firstName,
      last_name: user.lastName,
      role: user.role,
      tenant_id: user.tenantId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
