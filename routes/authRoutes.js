const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit'); // 🛡️ ADD IMPORT
const { User } = require('../models');
const authController = require('../controllers/authController');
const authenticateToken = require('../middleware/auth');

// 🛡️ CRITICAL FIX: Apply rate limiter ONLY to login to prevent brute force
// NOT applied to /auth/me or other routes to avoid blocking normal navigation
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 min
  keyGenerator: (req) => req.body?.email || 'unknown', // Rate limit per email
  message: { success: false, message: "Too many login attempts. Please wait 15 minutes." }
});

router.post('/register', authController.register);
// 🛡️ CRITICAL FIX: Apply rate limiter ONLY to login endpoint
router.post('/login', authLimiter, authController.login);

// 🛡️ HIGH FIX: Add logout endpoint to clear HTTP-only cookie
router.post('/logout', (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    });
    res.json({ success: true, message: "Logged out successfully!" });
});

// --- GET CURRENT USER (FIXED TO LOAD ALL PROFILE DATA ON REFRESH) ---
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            // Explicitly ask the database for the new fields!
            attributes: ['id', 'firstName', 'lastName', 'email', 'mobile', 'instituteId', 'dob']
        });

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.json({ success: true, user });
    } catch (error) {
        console.error("Fetch Profile Error:", error);
        res.status(500).json({ success: false, message: "Server error fetching profile" });
    }
});

// --- UPDATE USER PROFILE ---
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { firstName, lastName, mobile, dob, instituteId } = req.body;

        // Find the user in the database
        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Update the fields (only update if the user actually typed something)
        if (firstName) user.firstName = firstName;
        if (lastName) user.lastName = lastName;
        if (mobile !== undefined) user.mobile = mobile;
        if (instituteId !== undefined) user.instituteId = instituteId;
        if (dob !== undefined) user.dob = dob;

        // Save changes to the database
        await user.save();

        // Return the updated user (excluding the password!)
        const updatedUser = {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            mobile: user.mobile,
            instituteId: user.instituteId,
            dob: user.dob
        };

        res.json({ success: true, message: "Profile updated!", user: updatedUser });
    } catch (error) {
        console.error("Profile Update Error:", error);
        res.status(500).json({ success: false, message: "Server error updating profile" });
    }
});

router.put('/profile/password', authenticateToken, authController.changePassword);
router.delete('/profile', authenticateToken, authController.deleteAccount);

module.exports = router;