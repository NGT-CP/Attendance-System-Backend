const { Op } = require('sequelize');
const { AttendanceSession, AttendanceLog, ActivityLog, Classroom, Enrollment } = require('../models');

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

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expirationTime = new Date(Date.now() + 2 * 60000); // 2 mins

        const session = await AttendanceSession.create({
            class_id: classId,
            session_code: code,
            teacher_lat: lat || null,
            teacher_long: lng || null,
            require_gps: requireGps,
            expires_at: expirationTime,
            is_active: true
        });

        await AttendanceLog.create({
            session_id: session.id,
            student_id: teacherId,
            status: 'PRESENT',
            student_lat: lat || null,
            student_long: lng || null,
            distance_verified: true
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
        // 3. Geolocation Check 
        if (session.require_gps) {
            // 🛡️ PATCH: Explicitly check for null/undefined to prevent math errors
            if (lat == null || lng == null) {
                return res.status(400).json({ success: false, message: "GPS Location is required for this session." });
            }
            const distance = getDistanceInMeters(session.teacher_lat, session.teacher_long, lat, lng);
            if (distance > 150) return res.status(403).json({ success: false, message: `Too far! You are ${Math.round(distance)}m away. Must be within 150m.` });
        }

        // --- 🚨 UPDATED ANTI-PROXY VAULT ---
        const deviceId = req.headers['x-device-fingerprint'] || 'UNKNOWN_DEVICE';
        const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip;

        if (deviceId !== 'UNKNOWN_DEVICE') {
            const Sequelize = require('sequelize');
            const { Op } = Sequelize;

            // A. Strict "One Device = One Attendance Per Day" Blocker
            const deviceUsedToday = await ActivityLog.findOne({
                where: {
                    class_id: classId,
                    action: 'MARK_ATTENDANCE',
                    device_fingerprint: deviceId,
                    [Op.and]: [
                        Sequelize.where(Sequelize.fn('DATE', Sequelize.col('createdAt')), Sequelize.fn('CURDATE'))
                    ]
                }
            });

            // 🚨 FIXED: Now blocks the device entirely for this class today, even if it's the same student.
            if (deviceUsedToday) {
                return res.status(403).json({
                    success: false,
                    message: "Security Alert: This device has already been used to mark attendance for this class today."
                });
            }

            // B. "Account Bounce" Blocker (Scoped to Today using DB Timezone)
            const studentUsedOtherDeviceToday = await ActivityLog.findOne({
                where: {
                    class_id: classId,
                    user_id: studentId,
                    action: 'MARK_ATTENDANCE',
                    [Op.and]: [
                        Sequelize.where(Sequelize.fn('DATE', Sequelize.col('createdAt')), Sequelize.fn('CURDATE'))
                    ]
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

        const Sequelize = require('sequelize');
        const { Op } = Sequelize;

        // Check if a session already exists TODAY using DB Timezone
        let session = await AttendanceSession.findOne({
            where: {
                class_id: classId,
                [Op.and]: [
                    Sequelize.where(Sequelize.fn('DATE', Sequelize.col('createdAt')), Sequelize.fn('CURDATE'))
                ]
            }
        });

        if (session) {
            // Overwrite existing session
            session.session_code = 'CANCELLED';
            session.is_active = false;
            await session.save();

            // Destroy any attendance logs submitted today
            await AttendanceLog.destroy({ where: { session_id: session.id } });

            // 🔥 FIXED: Clear the Anti-Proxy vault for today using native DB dates
            await ActivityLog.destroy({
                where: {
                    class_id: classId,
                    action: 'MARK_ATTENDANCE',
                    [Op.and]: [
                        Sequelize.where(Sequelize.fn('DATE', Sequelize.col('createdAt')), Sequelize.fn('CURDATE'))
                    ]
                }
            });
        } else {
            // Create a new cancelled session
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