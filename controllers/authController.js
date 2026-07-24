const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const supabase = require('../config/supabase');

// ==========================================
// INTERNAL HELPERS
// ==========================================

const isValidPassword = (password) => {
    // Requires at least 8 chars, 1 uppercase, 1 number, 1 special character
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    return passwordRegex.test(password);
};

/**
 * Safely verifies a password. Returns { isMatch, isLegacy }.
 * TODO: Remove legacy plaintext branch once all users have been migrated to hashed passwords.
 */
const verifyPassword = async (inputPassword, storedPassword) => {
    const isBcrypt = storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$');

    if (isBcrypt) {
        return {
            isMatch: await bcrypt.compare(inputPassword, storedPassword),
            isLegacy: false
        };
    }

    // Legacy plaintext password path
    return {
        isMatch: inputPassword === storedPassword,
        isLegacy: true
    };
};

// ==========================================
// CONTROLLER EXPORTS
// ==========================================

exports.register = async (req, res) => {
    try {
        // Explicitly ignore any role provided in req.body for security
        const { firstName, lastName, email, password } = req.body;

        if (!firstName || !email || !password) {
            return res.status(400).json({ success: false, message: "Missing required fields: firstName, email, and password are required" });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ success: false, message: "Invalid email format. Please provide a valid email address." });
        }

        if (!isValidPassword(password)) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters with 1 uppercase letter, 1 number, and 1 special character (e.g., Test123!)"
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const { error } = await supabase
            .from('users')
            .insert([{
                first_name: firstName.trim(),
                last_name: lastName ? lastName.trim() : null,
                email: normalizedEmail,
                password: hashedPassword,
                role: 'student' // Strictly force safe default role
            }]);

        if (error) {
            if (error.code === '23505') {
                return res.status(400).json({ success: false, message: "Email already exists in the system" });
            }
            console.error("Supabase Insert Error:", error.message);
            return res.status(500).json({ success: false, message: "Server error during registration. Please try again later." });
        }

        res.status(201).json({ success: true, message: "Registered successfully!" });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ success: false, message: "An unexpected server error occurred during registration." });
    }
};


exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required" });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Retrieve only required auth fields
        const { data: user, error } = await supabase
            .from('users')
            .select('id, email, password, role')
            .eq('email', normalizedEmail)
            .maybeSingle();

        if (error) {
            console.error("[Auth] Login database error:", error.message);
            return res.status(500).json({ success: false, message: "Unable to process login. Please try again later." });
        }

        if (!user) {
            console.warn(`[Auth] Failed login attempt from IP: ${req.ip}`);
            return res.status(401).json({ success: false, message: "Invalid email or password" });
        }

        const { isMatch, isLegacy } = await verifyPassword(password, user.password);

        if (!isMatch) {
            console.warn(`[Auth] Failed login attempt from IP: ${req.ip}`);
            return res.status(401).json({ success: false, message: "Invalid email or password" });
        }

        // Silent legacy upgrade
        if (isLegacy) {
            try {
                const salt = await bcrypt.genSalt(10);
                const newHashedPassword = await bcrypt.hash(password, salt);

                const { error: updateError } = await supabase
                    .from('users')
                    .update({ password: newHashedPassword })
                    .eq('id', user.id);

                if (updateError) {
                    console.error(`[Security] Failed to save upgraded password for user ${user.id}:`, updateError.message);
                } else {
                    console.log(`[Security] Upgraded legacy password to secure hash for user ${user.id}`);
                }
            } catch (err) {
                console.error(`[Security] Bcrypt hashing error during migration for user ${user.id}:`, err.message);
            }
        }

        // Generate token with basic identification
        const token = jwt.sign({ id: user.id, role: user.role }, env.jwtSecret, { expiresIn: '24h' });

        // Set secure HTTP-only cookie
        const isProduction = env.nodeEnv === 'production';
        res.cookie('token', token, {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        // DO NOT return the token in the JSON payload
        res.json({ success: true, message: "Login successful!" });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ success: false, message: "An unexpected server error occurred during login." });
    }
};


exports.logout = (req, res) => {
    const isProduction = env.nodeEnv === 'production';
    res.clearCookie('token', {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax'
    });
    res.json({ success: true, message: "Logged out successfully!" });
};


exports.getMe = async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('id, first_name, last_name, email, mobile, institute_id, dob, role')
            .eq('id', req.user.id)
            .maybeSingle();

        if (error) {
            console.error("GetMe DB Error:", error.message);
            return res.status(500).json({ success: false, message: "Server error fetching profile" });
        }

        if (!user) {
            return res.status(404).json({ success: false, message: "User profile not found" });
        }

        // Map DB fields back to camelCase for the frontend
        const frontendUser = {
            id: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            email: user.email,
            mobile: user.mobile,
            instituteId: user.institute_id,
            dob: user.dob,
            role: user.role
        };

        res.json({ success: true, user: frontendUser });
    } catch (error) {
        console.error("Fetch Profile Ex:", error);
        res.status(500).json({ success: false, message: "Server error fetching profile" });
    }
};


exports.updateProfile = async (req, res) => {
    try {
        const { firstName, lastName, mobile, dob, instituteId } = req.body;
        const updates = {};

        // Explicitly check undefined to allow clearing optional fields if desired
        // Also trim string inputs
        if (typeof firstName === 'string' && firstName.trim() !== '') updates.first_name = firstName.trim();
        if (typeof lastName === 'string') updates.last_name = lastName.trim();
        if (mobile !== undefined) updates.mobile = typeof mobile === 'string' ? mobile.trim() : mobile;
        if (instituteId !== undefined) updates.institute_id = typeof instituteId === 'string' ? instituteId.trim() : instituteId;
        if (dob !== undefined) updates.dob = dob;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, message: "No valid fields provided for update" });
        }

        const { data: user, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', req.user.id)
            .select('id, first_name, last_name, email, mobile, institute_id, dob, role')
            .maybeSingle();

        if (error) {
            console.error("Update Profile DB Error:", error.message);
            return res.status(500).json({ success: false, message: "Failed to update profile. Please try again later." });
        }

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const updatedUser = {
            id: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            email: user.email,
            mobile: user.mobile,
            instituteId: user.institute_id,
            dob: user.dob,
            role: user.role
        };

        res.json({ success: true, message: "Profile updated successfully!", user: updatedUser });
    } catch (error) {
        console.error("Profile Update Ex:", error);
        res.status(500).json({ success: false, message: "Server error updating profile" });
    }
};


exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Both current and new passwords are required" });
        }

        if (!isValidPassword(newPassword)) {
            return res.status(400).json({
                success: false,
                message: "New password must be at least 8 characters with 1 uppercase letter, 1 number, and 1 special character"
            });
        }

        const { data: user, error } = await supabase
            .from('users')
            .select('password')
            .eq('id', req.user.id)
            .maybeSingle();

        if (error) {
            console.error("Change Password DB Error:", error.message);
            return res.status(500).json({ success: false, message: "An unexpected server error occurred." });
        }

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const { isMatch } = await verifyPassword(currentPassword, user.password);

        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Current password is incorrect" });
        }

        const salt = await bcrypt.genSalt(10);
        const newHashedPassword = await bcrypt.hash(newPassword, salt);

        const { error: updateError } = await supabase
            .from('users')
            .update({ password: newHashedPassword })
            .eq('id', req.user.id);

        if (updateError) {
            console.error("Change Password DB Update Error:", updateError.message);
            return res.status(500).json({ success: false, message: "Failed to update password. Please try again." });
        }

        res.json({ success: true, message: "Password updated successfully!" });
    } catch (error) {
        console.error("Change Password Ex:", error);
        res.status(500).json({ success: false, message: "An unexpected server error occurred." });
    }
};


exports.deleteAccount = async (req, res) => {
    try {
        const userId = req.user.id;

        // NOTE: Complete referential cleanup (classrooms, enrollments, etc.) relies entirely 
        // on PostgreSQL's ON DELETE CASCADE configuration for foreign keys.
        const { error } = await supabase
            .from('users')
            .delete()
            .eq('id', userId);

        if (error) {
            console.error("Delete Account DB Error:", error.message);
            return res.status(500).json({ success: false, message: "Failed to delete account. There may be associated data blocking deletion." });
        }

        const isProduction = env.nodeEnv === 'production';
        res.clearCookie('token', {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax'
        });

        res.json({ success: true, message: "Account deleted successfully." });
    } catch (error) {
        console.error("Delete Account Ex:", error);
        res.status(500).json({ success: false, message: "Server error deleting account." });
    }
};