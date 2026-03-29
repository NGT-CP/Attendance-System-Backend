const { User } = require('../models');
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
        if (!user) return res.status(401).json({ success: false, message: "Invalid credentials" });

        let isMatch = false;

        // 🛠️ Graceful Migration for Old Plaintext Passwords
        if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$') || user.password.startsWith('$2y$')) {
            // It's a new, hashed account
            isMatch = await bcrypt.compare(password, user.password);
        } else {
            // It's an old, plaintext account
            if (password === user.password) {
                isMatch = true;

                // Auto-upgrade their account to use bcrypt hashing seamlessly
                console.log(`Upgrading plaintext password to bcrypt for user: ${email}`);
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(password, salt);
                await user.save();
            }
        }

        if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

        // GENERATE TOKEN
        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '24h' });

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

        // 1. Find all classes owned by this teacher (if they are a teacher)
        const ownedClasses = await Classroom.findAll({ where: { owner_id: userId } });
        const classIds = ownedClasses.map(c => c.id);

        if (classIds.length > 0) {
            // Nuke all data inside their classes
            const sessions = await AttendanceSession.findAll({ where: { class_id: classIds } });
            const sessionIds = sessions.map(s => s.id);
            if (sessionIds.length > 0) await AttendanceLog.destroy({ where: { session_id: sessionIds } });

            await AttendanceSession.destroy({ where: { class_id: classIds } });

            const notices = await Notice.findAll({ where: { class_id: classIds } });
            const noticeIds = notices.map(n => n.id);
            if (noticeIds.length > 0) await ChatMessage.destroy({ where: { notice_id: noticeIds } });

            await Notice.destroy({ where: { class_id: classIds } });
            await Enrollment.destroy({ where: { class_id: classIds } });
            await ActivityLog.destroy({ where: { class_id: classIds } });
            await Classroom.destroy({ where: { owner_id: userId } });
        }

        // 2. Nuke user's specific data across the whole app (if they are a student)
        await ChatMessage.destroy({ where: { sender_id: userId } });
        await AttendanceLog.destroy({ where: { student_id: userId } });
        await Enrollment.destroy({ where: { user_id: userId } });
        await ActivityLog.destroy({ where: { user_id: userId } });

        // 3. Finally, delete the user
        await User.destroy({ where: { id: userId } });

        res.json({ success: true, message: "Account and all associated data permanently deleted." });
    } catch (error) {
        console.error("Delete Account Error:", error);
        res.status(500).json({ success: false, message: "Server error deleting account." });
    }
};