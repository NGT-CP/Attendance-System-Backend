const { AttendanceSession, AttendanceLog, ActivityLog, Classroom } = require('../models');

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

        // 3. Geolocation Check (Updated to 150m for Laptop Wi-Fi tolerance)
        if (session.require_gps) {
            if (!lat || !lng) return res.status(400).json({ success: false, message: "GPS Location is required." });
            const distance = getDistanceInMeters(session.teacher_lat, session.teacher_long, lat, lng);
            if (distance > 150) return res.status(403).json({ success: false, message: `Too far! You are ${Math.round(distance)}m away. Must be within 150m.` });
        }

        // --- 🚨 ANTI-PROXY VAULT LOGIC STARTS HERE ---
        const deviceId = req.headers['x-device-fingerprint'] || 'UNKNOWN_DEVICE';
        const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;

        if (deviceId !== 'UNKNOWN_DEVICE') {
            // A. "Pass-the-Phone" Blocker: Has this device been used by SOMEONE ELSE for this specific class session?
            const deviceUsedByOther = await ActivityLog.findOne({
                where: { class_id: classId, action: 'MARK_ATTENDANCE', device_fingerprint: deviceId }
            });

            if (deviceUsedByOther && deviceUsedByOther.user_id !== studentId) {
                console.log(`🚨 PROXY BLOCKED: User ${studentId} used device ${deviceId} belonging to ${deviceUsedByOther.user_id}`);
                return res.status(403).json({
                    success: false,
                    message: "Security Alert: This device has already been used to mark attendance for another student today."
                });
            }

            // B. "Account Bounce" Blocker: Has THIS student used a DIFFERENT device recently?
            const lastUserActivity = await ActivityLog.findOne({
                where: { user_id: studentId, action: 'MARK_ATTENDANCE' },
                order: [['createdAt', 'DESC']]
            });

            if (lastUserActivity && lastUserActivity.device_fingerprint !== deviceId) {
                console.log(`🚨 DEVICE SWITCH BLOCKED: User ${studentId} switched from ${lastUserActivity.device_fingerprint} to ${deviceId}`);
                return res.status(403).json({
                    success: false,
                    message: "Security Alert: Unrecognized device. You cannot switch devices to mark attendance."
                });
            }
        }
        // --- 🚨 ANTI-PROXY VAULT LOGIC ENDS HERE ---

        // 4. Record the Attendance
        await AttendanceLog.create({
            session_id: session.id,
            student_id: studentId,
            status: 'PRESENT',
            student_lat: lat,
            student_long: lng,
            distance_verified: session.require_gps
        });

        // 5. Log the Hardware details for future security checks
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
        const classroom = await Classroom.findByPk(req.params.id);
        if (classroom.owner_id !== req.user.id) return res.status(403).json({ message: "Only teachers can do this." });

        const session = await AttendanceSession.create({
            class_id: req.params.id,
            session_code: 'CANCELLED',
            is_active: false
        });

        res.json({ success: true, session });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to mark leave" });
    }
};