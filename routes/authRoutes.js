const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

// 1. Import Controller and Middleware
// ❌ No require('../models') allowed here anymore
const authController = require('../controllers/authController');
const authenticateToken = require('../middleware/auth');

// 2. Security Middleware
// 🛡️ Apply rate limiter ONLY to login to prevent brute force
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts per 15 min
    keyGenerator: (req) => req.body?.email || 'unknown',
    message: { success: false, message: "Too many login attempts. Please wait 15 minutes." }
});

// ==========================================
// PUBLIC ROUTES
// ==========================================
router.post('/register', authController.register);
router.post('/login', authLimiter, authController.login);

// The inline cookie-clearing logic has been delegated to the controller
router.post('/logout', authController.logout);

// ==========================================
// PROTECTED ROUTES (Requires valid JWT)
// ==========================================

// 🛡️ All inline Sequelize logic has been stripped and delegated to the controller
router.get('/me', authenticateToken, authController.getMe);
router.put('/profile', authenticateToken, authController.updateProfile);

router.put('/profile/password', authenticateToken, authController.changePassword);
router.delete('/profile', authenticateToken, authController.deleteAccount);

module.exports = router;