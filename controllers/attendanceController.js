const supabase = require('../config/supabase');
const deviceService = require('../services/deviceService');
const gpsIntelligenceService = require('../services/gpsIntelligenceService');

// --- HELPER: Haversine Formula for GPS Distance (in meters) ---
const getDistanceFromLatLonInM = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Radius of the earth in meters
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// ==========================================
// START ATTENDANCE SESSION
// ==========================================
exports.startSession = async (req, res) => {
    try {
        const classId = req.params.id;
        const { lat, lng, require_gps } = req.body;
        const teacherId = req.user.id;

        // 1. Verify Teacher Owns Class
        const { data: classroom } = await supabase
            .from('classrooms')
            .select('owner_id')
            .eq('id', classId)
            .maybeSingle();

        if (!classroom || classroom.owner_id !== teacherId) {
            return res.status(403).json({ success: false, message: "Only the teacher can start a session." });
        }

        // 2. Generate Code and Expiry (2 minutes)
        const sessionCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

        // 3. Insert Session
        const { error } = await supabase
            .from('attendance_sessions')
            .insert([{
                class_id: classId,
                session_code: sessionCode,
                teacher_lat: lat || null,
                teacher_long: lng || null,
                require_gps: require_gps === true,
                expires_at: expiresAt,
                is_active: true
            }]);

        if (error) throw error;

        res.json({ success: true, code: sessionCode });
    } catch (error) {
        console.error("Start Session Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to start attendance session." });
    }
};

// ==========================================
// MARK ATTENDANCE (Student)
// ==========================================
exports.markAttendance = async (req, res) => {
    try {
        const classId = req.params.id;
        const studentId = req.user.id;
        const { lat, lng, accuracy, timestamp, device_hash, code } = req.body;
        const gpsValidation = gpsIntelligenceService.validateGpsSignal(lat, lng, accuracy, timestamp, {
            maxAccuracy: 75, // Configurable for your specific campus density
            maxAgeMs: 120000 // 2 minutes
        });

        if (!gpsValidation.isValid) {
            // Return standard 400 response matching your existing API contract
            return res.status(400).json({
                success: false,
                message: gpsValidation.reason
            });
        }

        if (!code) return res.status(400).json({ success: false, message: "Attendance code is required." });

        // 1. Verify Student is Enrolled
        const { data: enrollment } = await supabase
            .from('enrollments')
            .select('id')
            .eq('user_id', studentId)
            .eq('class_id', classId)
            .maybeSingle();

        if (!enrollment) return res.status(403).json({ success: false, message: "You are not enrolled in this class." });

        // 2. Find Active Session
        const { data: session } = await supabase
            .from('attendance_sessions')
            .select('*')
            .eq('class_id', classId)
            .eq('session_code', code.trim().toUpperCase())
            .eq('is_active', true)
            .maybeSingle();

        if (!session) return res.status(404).json({ success: false, message: "Invalid or expired attendance code." });

        // 3. Check Expiration
        if (new Date() > new Date(session.expires_at)) {
            return res.status(400).json({ success: false, message: "This attendance code has expired." });
        }

        // 4. GPS Verification
        let distanceVerified = true;
        if (session.require_gps) {
            if (!lat || !lng || !session.teacher_lat || !session.teacher_long) {
                return res.status(400).json({ success: false, message: "Location data is required for this session." });
            }
            const distance = getDistanceFromLatLonInM(session.teacher_lat, session.teacher_long, lat, lng);
            if (distance > 50) { // 50 meters radius
                return res.status(400).json({ success: false, message: `You are too far from the classroom (${Math.round(distance)}m away).` });
            }
        }

        const deviceHash = req.body.device_hash || 'UNKNOWN_DEVICE';
        const deviceEvaluation = await deviceService.evaluateDevice(studentId, deviceHash);

        // 5. Log Attendance
        const { error: logError } = await supabase
            .from('attendance_logs')
            .insert([{
                session_id: session.id,
                student_id: studentId,
                status: 'present',
                student_lat: lat || null,
                student_long: lng || null,
                distance_verified: distanceVerified
            }]);

        if (logError) {
            if (logError.code === '23505') { // Unique constraint violation
                return res.status(400).json({ success: false, message: "You have already marked attendance for this session." });
            }
            throw logError;
        }

        res.json({ success: true, message: "Attendance marked successfully!" });
    } catch (error) {
        console.error("Mark Attendance Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to mark attendance." });
    }
};

// ==========================================
// CANCEL SESSION (Mark Leave)
// ==========================================
exports.cancelSession = async (req, res) => {
    try {
        const classId = req.params.id;
        const teacherId = req.user.id;

        const { data: classroom } = await supabase
            .from('classrooms')
            .select('owner_id')
            .eq('id', classId)
            .maybeSingle();

        if (!classroom || classroom.owner_id !== teacherId) {
            return res.status(403).json({ success: false, message: "Unauthorized access." });
        }

        const { error } = await supabase
            .from('attendance_sessions')
            .insert([{
                class_id: classId,
                session_code: 'CANCELLED',
                is_active: false
            }]);

        if (error) throw error;
        res.json({ success: true, message: "Class marked as cancelled." });
    } catch (error) {
        console.error("Cancel Session Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to cancel class." });
    }
};