const { AttendanceSession, AttendanceLog, ActivityLog, Classroom } = require('../models');
const axios = require('axios');

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
        const expirationTime = new Date(Date.now() + 2 * 60000);

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

        const session = await AttendanceSession.findOne({
            where: { class_id: classId, session_code: code, is_active: true }
        });

        if (!session) return res.status(404).json({ success: false, message: "Invalid code." });

        if (new Date() > new Date(session.expires_at)) {
            session.is_active = false;
            await session.save();
            return res.status(403).json({ success: false, message: "This attendance code has expired!" });
        }

        const existingLog = await AttendanceLog.findOne({
            where: { session_id: session.id, student_id: studentId }
        });

        if (existingLog) return res.status(400).json({ success: false, message: "You have already marked your attendance for this session!" });

        if (session.require_gps) {
            if (!lat || !lng) return res.status(400).json({ success: false, message: "GPS Location is required." });
            const distance = getDistanceInMeters(session.teacher_lat, session.teacher_long, lat, lng);
            if (distance > 50) return res.status(403).json({ success: false, message: `Too far! You are ${Math.round(distance)}m away.` });
        }

        const deviceId = req.headers['x-device-fingerprint'] || 'UNKNOWN_DEVICE';
        const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;

        let aiAction = "ALLOW";

        try {
            const aiResponse = await axios.post('http://127.0.0.1:5001/analyze-attendance', {
                user_id: studentId,
                ip_address: ipAddress,
                device_fingerprint: deviceId,
                lat: lat || 0,
                lng: lng || 0
            });

            aiAction = aiResponse.data.action;

            if (aiAction === "BLOCK") {
                return res.status(403).json({ success: false, message: "🚨 Security Alert: Proxy attendance detected. Access denied." });
            }
        } catch (aiError) {
            console.error("Python AI is unreachable. Skipping AI check.", aiError.message);
        }

        await AttendanceLog.create({
            session_id: session.id,
            student_id: studentId,
            status: 'PRESENT',
            student_lat: lat,
            student_long: lng,
            distance_verified: session.require_gps
        });

        try {
            await ActivityLog.create({
                user_id: studentId,
                class_id: classId,
                action: 'MARK_ATTENDANCE',
                ip_address: ipAddress,
                device_fingerprint: deviceId
            });
        } catch (logErr) { console.error("Log error:", logErr.message); }

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