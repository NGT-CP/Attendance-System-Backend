const { User, sequelize } = require('../models');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Classroom, Notice, ChatMessage, AttendanceSession, AttendanceLog, Enrollment, ActivityLog } = require('../models');

// Use environment variable or fallback for development
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("CRITICAL ERROR: JWT_SECRET environment variable is not set!");
    process.exit(1);
}

exports.register = async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;

        console.log(`[DEBUG] Register attempt - Email: ${email}, FirstName: ${firstName}`);

        if (!firstName || !email || !password) {
            console.log(`[DEBUG] Missing fields - firstName: ${firstName}, email: ${email}, password: ${password ? 'provided' : 'missing'}`);
            return res.status(400).json({ success: false, message: "Missing required fields: firstName, email, and password are required" });
        }

        // 🛡️ HIGH FIX #3: Add email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            console.log(`[DEBUG] Invalid email format: ${email}`);
            return res.status(400).json({ success: false, message: "Invalid email format. Please provide a valid email address." });
        }

        // Check if email already exists
        console.log(`[DEBUG] Checking if email already exists: ${email}`);
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            console.log(`[DEBUG] Email already registered: ${email}`);
            return res.status(400).json({ success: false, message: "Email already registered. Try logging in instead." });
        }

        // 🛠️ The regex now matches your React frontend exactly
        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
        if (!passwordRegex.test(password)) {
            console.log(`[DEBUG] Password does not meet requirements`);
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters with 1 uppercase letter, 1 number, and 1 special character (e.g., Test123!)"
            });
        }

        // SECURE: Hash the password before saving
        console.log(`[DEBUG] Hashing password for: ${email}`);
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        console.log(`[DEBUG] Creating user in database: ${email}`);
        const newUser = await User.create({
            firstName,
            lastName,
            email,
            password: hashedPassword
        });

        console.log(`[SUCCESS] User registered successfully: ${email}`);
        res.status(201).json({ success: true, message: "Registered successfully!" });
    } catch (error) {
        console.error("Register Error:", error.message);
        console.error("Full error:", error);

        // Provide specific error messages based on the error type
        if (error.name === 'SequelizeUniqueConstraintError') {
            console.log(`[DEBUG] Unique constraint error - likely duplicate email`);
            return res.status(400).json({ success: false, message: "Email already exists in the system" });
        }
        if (error.name === 'SequelizeValidationError') {
            const messages = error.errors.map(e => e.message).join(", ");
            console.log(`[DEBUG] Validation error: ${messages}`);
            return res.status(400).json({ success: false, message: `Validation error: ${messages}` });
        }

        res.status(500).json({ success: false, message: `Registration failed: ${error.message}` });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        console.log(`[DEBUG] Login attempt with email: ${email}`);

        if (!email || !password) {
            console.log(`[DEBUG] Missing email or password`);
            return res.status(400).json({ success: false, message: "Email and password are required" });
        }

        console.log(`[DEBUG] Searching for user with email: ${email}`);
        const user = await User.findOne({ where: { email } });

        if (!user) {
            console.warn(`[SECURITY] Failed login attempt - email not found: ${email} from IP: ${req.ip}`);
            console.log(`[DEBUG] User not found for email: ${email}`);
            return res.status(401).json({ success: false, message: "Invalid email or password" });
        }

        console.log(`[DEBUG] User found: ${user.email}, checking password...`);

        let isMatch = false;

        // 🛡️ SMART MIGRATION: Auto-upgrade old plaintext passwords
        // Check if the password lacks the standard bcrypt '$2a$' or '$2b$' prefix
        if (!user.password.startsWith('$2a$') && !user.password.startsWith('$2b$')) {
            console.log(`[DEBUG] Legacy plaintext password detected for ${email}`);

            if (password === user.password) {
                isMatch = true;
                // Auto-upgrade them silently in the background
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(password, salt);
                await user.save();
                console.log(`[SUCCESS] Upgraded legacy password to secure hash for ${email}`);
            }
        } else {
            // Normal secure bcrypt comparison for hashed passwords
            try {
                isMatch = await bcrypt.compare(password, user.password);
                console.log(`[DEBUG] Password match result: ${isMatch}`);
            } catch (err) {
                console.error(`[SECURITY] Bcrypt error for ${email}:`, err.message);
            }
        }

        if (!isMatch) {
            console.warn(`[SECURITY] Failed login attempt - wrong password for: ${email} from IP: ${req.ip}`);
            return res.status(401).json({ success: false, message: "Invalid email or password" });
        }

        // GENERATE TOKEN
        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '24h' });

        // 🛡️ CRITICAL PRODUCTION FIX 3: Cross-Domain Auth Cookie
        // Match the CSRF cookie settings for consistency across different domains
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',  // Force HTTPS in production
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',  // 'none' for cross-domain, 'lax' for localhost
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        console.log(`[SUCCESS] User logged in: ${email}`);
        res.json({ success: true, message: "Login successful!", token });
    } catch (error) {
        console.error("Login Error:", error.message);
        console.error("Full error:", error);
        res.status(500).json({ success: false, message: `Login failed: ${error.message}` });
    }
};
// --- CHANGE PASSWORD ---
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Both current and new passwords are required" });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Current password is incorrect" });
        }

        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
        if (!passwordRegex.test(newPassword)) {
            return res.status(400).json({
                success: false,
                message: "New password must be at least 8 characters with 1 uppercase letter, 1 number, and 1 special character"
            });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        console.log(`[SUCCESS] Password changed for user: ${user.email}`);
        res.json({ success: true, message: "Password updated successfully!" });
    } catch (error) {
        console.error("Change Password Error:", error);
        res.status(500).json({ success: false, message: `Password change failed: ${error.message}` });
    }
};

// --- DELETE ACCOUNT & CASCADE EVERYTHING ---
exports.deleteAccount = async (req, res) => {
    try {
        const userId = req.user.id;

        // 🛡️ CRITICAL FIX: Wrap cascade deletion in transaction to prevent orphaned data
        await sequelize.transaction(async (t) => {
            // 1. Find all classes owned by this teacher (if they are a teacher)
            const ownedClasses = await Classroom.findAll({ where: { owner_id: userId }, transaction: t });
            const classIds = ownedClasses.map(c => c.id);

            if (classIds.length > 0) {
                // Nuke all data inside their classes
                const sessions = await AttendanceSession.findAll({ where: { class_id: classIds }, transaction: t });
                const sessionIds = sessions.map(s => s.id);
                if (sessionIds.length > 0) await AttendanceLog.destroy({ where: { session_id: sessionIds }, transaction: t });

                await AttendanceSession.destroy({ where: { class_id: classIds }, transaction: t });

                const notices = await Notice.findAll({ where: { class_id: classIds }, transaction: t });
                const noticeIds = notices.map(n => n.id);
                if (noticeIds.length > 0) await ChatMessage.destroy({ where: { notice_id: noticeIds }, transaction: t });

                await Notice.destroy({ where: { class_id: classIds }, transaction: t });
                await Enrollment.destroy({ where: { class_id: classIds }, transaction: t });
                await ActivityLog.destroy({ where: { class_id: classIds }, transaction: t });
                await Classroom.destroy({ where: { owner_id: userId }, transaction: t });
            }

            // 2. Nuke user's specific data across the whole app (if they are a student)
            await ChatMessage.destroy({ where: { sender_id: userId }, transaction: t });
            await AttendanceLog.destroy({ where: { student_id: userId }, transaction: t });
            await Enrollment.destroy({ where: { user_id: userId }, transaction: t });
            await ActivityLog.destroy({ where: { user_id: userId }, transaction: t });

            // 3. Log the account deletion for audit purposes
            // TODO: Create AuditLog table and log here

            // 4. Finally, delete the user
            await User.destroy({ where: { id: userId }, transaction: t });
        });

        res.json({ success: true, message: "Account and all associated data permanently deleted." });
    } catch (error) {
        console.error("Delete Account Error:", error);
        res.status(500).json({ success: false, message: "Server error deleting account." });
    }
};