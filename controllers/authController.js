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

        if (!firstName || !email || !password) {
            return res.status(400).json({ success: false, error: "Missing fields" });
        }

        // 🛡️ HIGH FIX #3: Add email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: "Invalid email format" });
        }

        // Check if email already exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "Email already registered. Try logging in instead." });
        }

        // 🛠️ The regex now matches your React frontend exactly
        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 chars, with 1 uppercase, 1 number, and 1 special char."
            });
        }

        // SECURE: Hash the password before saving
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await User.create({
            firstName,
            lastName,
            email,
            password: hashedPassword
        });

        res.status(201).json({ success: true, message: "Registered successfully!" });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ where: { email } });
        if (!user) {
            // 🛡️ Log failed login attempts for security monitoring
            console.warn(`[SECURITY] Failed login attempt for email: ${email} from IP: ${req.ip}`);
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        // 🛡️ PRODUCTION FIX: Strict bcrypt-only password validation
        // Do NOT support plaintext passwords - they are a data breach risk
        let isMatch = false;
        try {
            isMatch = await bcrypt.compare(password, user.password);
        } catch (err) {
            // bcrypt.compare will reject invalid hash formats
            console.error(`[SECURITY] Password comparison failed for ${email}:`, err.message);
            isMatch = false;
        }

        if (!isMatch) {
            console.warn(`[SECURITY] Failed login attempt for email: ${email} from IP: ${req.ip}`);
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        // GENERATE TOKEN
        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '24h' });

        // 🛡️ HIGH FIX #2: Send token in HTTP-only cookie AND response body
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // HTTPS only in production
            sameSite: 'lax', // Use 'lax' not 'strict' to allow cross-origin requests in development
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        res.json({ success: true, message: "Login successful!", token });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};
// --- CHANGE PASSWORD ---
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findByPk(req.user.id);

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "Incorrect current password." });

        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
        if (!passwordRegex.test(newPassword)) {
            return res.status(400).json({ success: false, message: "New password does not meet security requirements." });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.json({ success: true, message: "Password updated successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error updating password." });
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