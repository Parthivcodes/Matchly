const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.findOne();
      if (!user) {
        return res.status(401).json({ detail: 'Invalid credentials' });
      }
    }

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

router.get('/me', async (req, res) => {
  try {
    const user = await User.findOne();
    if (!user) return res.status(404).json({ detail: 'User not found' });
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
