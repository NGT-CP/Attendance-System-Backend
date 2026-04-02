const crypto = require('crypto');
const Sequelize = require('sequelize');
const { Op } = require('sequelize');
const { AttendanceSession, AttendanceLog, ActivityLog, Classroom, Enrollment, sequelize } = require('../models');

// 🛡️ CRITICAL FIX #1: Secure cryptographic code generation
const generateSecureCode = () => {
    return crypto.randomInt(100000, 999999).toString();
};

// --- HELPER OUTSIDE THE EXPORTS ---
const getDistanceInMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

exports.startSession = async (req, res) => {
    try {
        const { lat, lng, requireGps } = req.body;
        const classId = req.params.id;
        const teacherId = req.user.id;

        const isTeacher = await Classroom.findOne({ where: { id: classId, owner_id: teacherId } });
        if (!isTeacher) return res.status(403).json({ success: false, message: "Only the teacher can start an attendance session." });

        // 🛡️ CRITICAL FIX #2: Wrap in transaction to prevent race conditions
        const session = await sequelize.transaction(async (t) => {
            // 🔥 THE FIX: Calculate exact start and end of TODAY in Node.js
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);

            // Find session between 12:00 AM and 11:59 PM today (atomic operation in transaction)
            let sess = await AttendanceSession.findOne({
                where: {
                    class_id: classId,
                    createdAt: {
                        [Op.between]: [startOfDay, endOfDay]
                    }
                },
                transaction: t
            });

            const code = generateSecureCode(); // 🛡️ Using secure crypto now
            const expirationTime = new Date(Date.now() + 2 * 60000); // 2 mins

            if (sess) {
                // Update the existing session! No more duplicates.
                sess.session_code = code;
                sess.teacher_lat = lat || null;
                sess.teacher_long = lng || null;
                sess.require_gps = requireGps;
                sess.expires_at = expirationTime;
                sess.is_active = true;
                await sess.save({ transaction: t });
            } else {
                // Create a brand new session
                sess = await AttendanceSession.create({
                    class_id: classId,
                    session_code: code,
                    teacher_lat: lat || null,
                    teacher_long: lng || null,
                    require_gps: requireGps,
                    expires_at: expirationTime,
                    is_active: true
                }, { transaction: t });
            }

            const existingTeacherLog = await AttendanceLog.findOne({
                where: { session_id: sess.id, student_id: teacherId },
                transaction: t
            });

            if (!existingTeacherLog) {
                await AttendanceLog.create({
                    session_id: sess.id,
                    student_id: teacherId,
                    status: 'PRESENT',
                    student_lat: lat || null,
                    student_long: lng || null,
                    distance_verified: true
                }, { transaction: t });
            }

            return sess;
        });

        res.json({ success: true, code: session.session_code, expires_at: session.expires_at });
    } catch (error) {
        console.error("Start Session Error:", error);
        res.status(500).json({ success: false, message: "Failed to start session" });
    }
};

exports.markAttendance = async (req, res) => {
    try {
        const { code, lat, lng } = req.body;
        const classId = req.params.id;
        const studentId = req.user.id;

        // 🔥 NEW: Ensure the student actually belongs to this class before accepting codes
        const isEnrolled = await Enrollment.findOne({ where: { user_id: studentId, class_id: classId } });
        if (!isEnrolled) {
            return res.status(403).json({ success: false, message: "You cannot mark attendance for a class you haven't joined." });
        }

        // 1. Session & Code Verification
        const session = await AttendanceSession.findOne({
            where: { class_id: classId, session_code: code, is_active: true }
        });

        if (!session) return res.status(404).json({ success: false, message: "Invalid or inactive code." });

        if (new Date() > new Date(session.expires_at)) {
            session.is_active = false;
            await session.save();
            return res.status(403).json({ success: false, message: "This attendance code has expired!" });
        }

        // 2. Duplicate Check
        const existingLog = await AttendanceLog.findOne({
            where: { session_id: session.id, student_id: studentId }
        });

        if (existingLog) return res.status(400).json({ success: false, message: "You have already marked your attendance for this session!" });

        // 3. Geolocation Check
        // 🛡️ CRITICAL FIX #3: Explicit null check + range validation before distance calculation
        if (session.require_gps) {
            if (lat == null || lng == null) {
                return res.status(400).json({ success: false, message: "GPS Location is required for this session." });
            }
            // Validate GPS coordinates are in valid ranges and not NaN/Infinity
            if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                return res.status(400).json({ success: false, message: "Invalid GPS coordinates provided." });
            }
            const distance = getDistanceInMeters(session.teacher_lat, session.teacher_long, lat, lng);
            if (distance > 150) return res.status(403).json({ success: false, message: `Too far! You are ${Math.round(distance)}m away. Must be within 150m.` });
        }

        // --- 🚨 UPDATED ANTI-PROXY VAULT ---
        const deviceId = req.headers['x-device-fingerprint'] || 'UNKNOWN_DEVICE';
        const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip;

        if (deviceId !== 'UNKNOWN_DEVICE') {
            // Calculate exact start and end of TODAY to avoid timezone issues
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);

            // A. Strict "One Device = One Attendance Per Day" Blocker
            const deviceUsedToday = await ActivityLog.findOne({
                where: {
                    class_id: classId,
                    action: 'MARK_ATTENDANCE',
                    device_fingerprint: deviceId,
                    createdAt: {
                        [Op.between]: [startOfDay, endOfDay]
                    }
                }
            });

            // 🚨 FIXED: Now blocks the device entirely for this class today, even if it's the same student.
            if (deviceUsedToday) {
                return res.status(403).json({
                    success: false,
                    message: "Security Alert: This device has already been used to mark attendance for this class today."
                });
            }

            // B. "Account Bounce" Blocker (Scoped to Today)
            const studentUsedOtherDeviceToday = await ActivityLog.findOne({
                where: {
                    class_id: classId,
                    user_id: studentId,
                    action: 'MARK_ATTENDANCE',
                    createdAt: {
                        [Op.between]: [startOfDay, endOfDay]
                    }
                }
            });

            if (studentUsedOtherDeviceToday && studentUsedOtherDeviceToday.device_fingerprint !== deviceId) {
                return res.status(403).json({
                    success: false,
                    message: "Security Alert: You have already attempted to mark attendance with a different device today."
                });
            }
        }
        // --- 🚨 ANTI-PROXY VAULT ENDS HERE ---

        // 4. Record the Attendance
        await AttendanceLog.create({
            session_id: session.id,
            student_id: studentId,
            status: 'PRESENT',
            student_lat: lat,
            student_long: lng,
            distance_verified: session.require_gps
        });

        // 5. Log the Hardware details
        await ActivityLog.create({
            user_id: studentId,
            class_id: classId,
            action: 'MARK_ATTENDANCE',
            ip_address: ipAddress,
            device_fingerprint: deviceId
        });

        res.json({ success: true, message: "Attendance verified and marked present!" });
    } catch (error) {
        console.error("Mark Attendance Error:", error);
        res.status(500).json({ success: false, message: "Server error marking attendance" });
    }
};

exports.cancelSession = async (req, res) => {
    try {
        const classId = req.params.id;
        const classroom = await Classroom.findByPk(classId);
        if (classroom.owner_id !== req.user.id) return res.status(403).json({ message: "Only teachers can do this." });

        // 🔥 THE FIX: Calculate exact start and end of TODAY in Node.js
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        let session = await AttendanceSession.findOne({
            where: {
                class_id: classId,
                createdAt: {
                    [Op.between]: [startOfDay, endOfDay]
                }
            }
        });

        if (session) {
            session.session_code = 'CANCELLED';
            session.is_active = false;
            await session.save();

            await AttendanceLog.destroy({ where: { session_id: session.id } });

            await ActivityLog.destroy({
                where: {
                    class_id: classId,
                    action: 'MARK_ATTENDANCE',
                    createdAt: {
                        [Op.between]: [startOfDay, endOfDay]
                    }
                }
            });
        } else {
            session = await AttendanceSession.create({
                class_id: classId,
                session_code: 'CANCELLED',
                is_active: false
            });
        }

        res.json({ success: true, session });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to mark leave" });
    }
};