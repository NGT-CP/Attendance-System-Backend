const { Classroom, Enrollment, User, AttendanceSession, AttendanceLog, ActivityLog, Notice, ChatMessage } = require('../models');
const { generateUniqueCode } = require('../codeGenerator');

exports.getMyClasses = async (req, res) => {
    try {
        const studentId = req.user.id;
        const userWithClasses = await User.findByPk(studentId, {
            include: [{
                model: Classroom,
                through: { attributes: [] },
                include: [{ model: User, attributes: ['firstName', 'lastName'] }]
            }]
        });
        const classes = userWithClasses && userWithClasses.Classrooms ? userWithClasses.Classrooms : [];
        res.json({ success: true, classes });
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch classes" });
    }
};

exports.createClass = async (req, res) => {
    try {
        const { class_name } = req.body;
        const owner_id = req.user.id;
        if (!class_name) return res.status(400).json({ success: false, message: "Class name is required" });

        const join_code = await generateUniqueCode();

        const newClass = await Classroom.create({ class_name, join_code, owner_id });
        await Enrollment.create({ user_id: owner_id, class_id: newClass.id });

        try {
            await ActivityLog.create({
                user_id: owner_id,
                class_id: newClass.id,
                action: 'CREATE_CLASS',
                ip_address: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip,
                device_fingerprint: req.headers['x-device-fingerprint'] || 'UNKNOWN_DEVICE'
            });
        } catch (logErr) { console.error("Log error:", logErr.message); }

        res.status(201).json({ success: true, classroom: newClass });
    } catch (error) {
        console.error("Create Class Error:", error);
        res.status(500).json({ success: false, message: "Failed to create class" });
    }
};

exports.joinClass = async (req, res) => {
    try {
        const { join_code } = req.body;
        const userId = req.user.id;

        if (!join_code) return res.status(400).json({ success: false, message: "Join code is required" });

        const classroom = await Classroom.findOne({ where: { join_code } });
        if (!classroom) return res.status(404).json({ success: false, message: "Invalid class code. Please try again." });

        const existingEnrollment = await Enrollment.findOne({ where: { user_id: userId, class_id: classroom.id } });
        if (existingEnrollment) return res.status(400).json({ success: false, message: "You are already enrolled in this class!" });

        await Enrollment.create({ user_id: userId, class_id: classroom.id });

        try {
            await ActivityLog.create({
                user_id: userId,
                class_id: classroom.id,
                action: 'JOIN_CLASS',
                ip_address: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip,
                device_fingerprint: req.headers['x-device-fingerprint'] || 'UNKNOWN_DEVICE'
            });
        } catch (logErr) { console.error("Log error:", logErr.message); }

        res.json({ success: true, message: "Successfully joined class!" });
    } catch (error) {
        console.error("Join Class Error:", error);
        res.status(500).json({ message: "Server error joining class" });
    }
};

exports.getDashboardData = async (req, res) => {
    try {
        const classId = req.params.id;
        const userId = req.user.id;

        const classroom = await Classroom.findByPk(classId);
        if (!classroom) return res.status(404).json({ success: false, message: "Class not found" });

        const isTeacher = classroom.owner_id === userId;

        if (!isTeacher) {
            const isEnrolled = await Enrollment.findOne({
                where: { user_id: userId, class_id: classId }
            });
            if (!isEnrolled) {
                return res.status(403).json({ success: false, message: "Access Denied." });
            }
        }

        const notices = await Notice.findAll({
            where: { class_id: classId },
            include: [
                { model: User, as: 'Author', attributes: ['firstName', 'lastName'] },
                {
                    model: ChatMessage,
                    include: [{ model: User, as: 'Sender', attributes: ['firstName', 'lastName'] }]
                }
            ],
            order: [['createdAt', 'DESC'], [ChatMessage, 'createdAt', 'ASC']]
        });

        // --- STRICT FILTERING LOGIC ---
        const rawSessions = await AttendanceSession.findAll({
            where: { class_id: classId },
            order: [['createdAt', 'DESC']]
        });

        const uniqueSessionsMap = new Map();
        rawSessions.forEach(session => {
            if (session.session_code === 'CANCELLED') return; // Throw away cancelled

            // Group by calendar day so duplicates are merged into 1
            const dateStr = new Date(session.createdAt).toDateString();
            if (!uniqueSessionsMap.has(dateStr)) {
                uniqueSessionsMap.set(dateStr, session);
            }
        });

        const finalValidSessions = Array.from(uniqueSessionsMap.values());
        const totalSessions = finalValidSessions.length;

        // --- ROSTER & PERCENTAGE MATH ---
        let myAttendance = [];
        if (!isTeacher) {
            myAttendance = await AttendanceLog.findAll({
                where: { student_id: userId },
                include: [{ model: AttendanceSession, where: { class_id: classId } }]
            });
        }

        const allLogs = await AttendanceLog.findAll({
            include: [{ model: AttendanceSession, where: { class_id: classId }, attributes: [] }],
            attributes: ['student_id']
        });

        const logCounts = {};
        allLogs.forEach(log => {
            logCounts[log.student_id] = (logCounts[log.student_id] || 0) + 1;
        });

        const enrollments = await Enrollment.findAll({
            where: { class_id: classId },
            include: [{ model: User, attributes: ['id', 'firstName', 'lastName'] }]
        });

        const rosterData = enrollments.map(enr => {
            const student = enr.User;
            if (!student || student.id === classroom.owner_id) return null;

            const attendedCount = logCounts[student.id] || 0;
            const actualPercent = totalSessions === 0 ? 0 : Math.floor((attendedCount / totalSessions) * 100);

            return {
                id: student.id,
                name: `${student.firstName} ${student.lastName}`,
                percent: isTeacher ? actualPercent : null
            };
        });

        const cleanRoster = rosterData.filter(r => r !== null);
        const teacher = await User.findByPk(classroom.owner_id);
        const fullRoster = [{ id: teacher.id, name: `${teacher.firstName} ${teacher.lastName}`, isTeacher: true }, ...cleanRoster];

        // 🚨 DIAGNOSTIC LOG 🚨
        console.log(`\n--- CLASS ${classId} DIAGNOSTICS ---`);
        console.log(`Raw Database Rows: ${rawSessions.length}`);
        console.log(`Filtered Unique Days (totalSessions): ${totalSessions}`);
        console.log(`-----------------------------------\n`);

        res.json({
            success: true,
            classroom,
            notices,
            attendance: myAttendance,
            allSessions: finalValidSessions, // Sending the filtered array
            roster: fullRoster
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to fetch data" });
    }
};

exports.updateClass = async (req, res) => {
    try {
        const classroom = await Classroom.findByPk(req.params.id);
        if (!classroom) return res.status(404).json({ success: false, message: "Class Not found" });
        if (classroom.owner_id !== req.user.id) return res.status(403).json({ success: false, message: "Admin only Access" });

        classroom.class_name = req.body.class_name;
        await classroom.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Server error" }); }
};

exports.deleteClass = async (req, res) => {
    try {
        const classroom = await Classroom.findByPk(req.params.id);
        if (!classroom) return res.status(404).json({ success: false, message: "Not found" });
        if (classroom.owner_id !== req.user.id) return res.status(403).json({ success: false, message: "Not allowed" });

        // 🛠️ FIX: Manually cascade delete all child records to prevent SQL crash
        // 1. Delete Attendance Logs & Sessions
        const sessions = await AttendanceSession.findAll({ where: { class_id: classroom.id } });
        const sessionIds = sessions.map(s => s.id);
        if (sessionIds.length > 0) {
            await AttendanceLog.destroy({ where: { session_id: sessionIds } });
        }
        await AttendanceSession.destroy({ where: { class_id: classroom.id } });

        // 2. Delete Chat Messages & Notices
        const notices = await Notice.findAll({ where: { class_id: classroom.id } });
        const noticeIds = notices.map(n => n.id);
        if (noticeIds.length > 0) {
            await ChatMessage.destroy({ where: { notice_id: noticeIds } });
        }
        await Notice.destroy({ where: { class_id: classroom.id } });

        // 3. Delete Enrollments & Activity Logs
        await Enrollment.destroy({ where: { class_id: classroom.id } });
        await ActivityLog.destroy({ where: { class_id: classroom.id } });

        // 4. Finally, delete the classroom
        await classroom.destroy();
        res.json({ success: true });
    } catch (err) {
        console.error("Delete Class Error:", err);
        res.status(500).json({ message: "Server error deleting class" });
    }
};

exports.regenerateCode = async (req, res) => {
    try {
        const classroom = await Classroom.findByPk(req.params.id);
        if (!classroom) return res.status(404).json({ success: false, message: "Class Not found" });
        if (classroom.owner_id !== req.user.id) return res.status(403).json({ success: false, message: "Admin only Access" });

        const new_code = await generateUniqueCode();

        classroom.join_code = new_code;
        await classroom.save();
        res.json({ success: true, new_code });
    } catch (err) { res.status(500).json({ message: "Server error" }); }
};

exports.getOverviewStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const enrollments = await Enrollment.findAll({
            where: { user_id: userId },
            include: [{ model: Classroom, include: [{ model: User, attributes: ['firstName', 'lastName'] }] }]
        });

        const classes = enrollments.map(e => e.Classroom).filter(c => c !== null);
        const classIds = classes.map(c => c.id);

        if (classIds.length === 0) return res.json({ success: true, classes: [], trend: [] });

        const allSessions = await AttendanceSession.findAll({ where: { class_id: classIds } });
        const allLogs = await AttendanceLog.findAll({
            where: { student_id: userId },
            include: [{
                model: AttendanceSession,
                attributes: ['id', 'createdAt']
            }]
        });

        const classStats = classes.map(cls => {
            // 🔥 Get sessions for this class, ignoring CANCELLED
            const clsSessions = allSessions.filter(s => s.class_id === cls.id && s.session_code !== 'CANCELLED');

            // 🔥 Keep only unique dates
            const uniqueDates = new Set(clsSessions.map(s => new Date(s.createdAt).toDateString()));
            const total = uniqueDates.size;

            // Count attended days - use the SESSION date, not the log date
            const clsLogs = allLogs.filter(l => clsSessions.some(s => s.id === l.session_id));
            const attendedDates = new Set(clsLogs.map(l => new Date(l.AttendanceSession.createdAt).toDateString()));
            const attended = attendedDates.size;

            return { ...cls.toJSON(), attendancePercent: total === 0 ? 0 : Math.floor((attended / total) * 100) };
        });

        const monthlyStats = {};
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            monthlyStats[monthNames[d.getMonth()]] = { total: 0, attended: 0 };
        }

        allSessions.forEach(session => {
            if (session.session_code === 'CANCELLED') return;
            const monthName = monthNames[new Date(session.createdAt).getMonth()];
            if (monthlyStats[monthName]) monthlyStats[monthName].total += 1;
        });

        allLogs.forEach(log => {
            // Use SESSION date, not log creation date
            const monthName = monthNames[new Date(log.AttendanceSession.createdAt).getMonth()];
            if (monthlyStats[monthName]) monthlyStats[monthName].attended += 1;
        });

        const trend = Object.keys(monthlyStats).map(month => {
            const stat = monthlyStats[month];
            return { month, attendance: stat.total === 0 ? 0 : Math.floor((stat.attended / stat.total) * 100) };
        });

        res.json({ success: true, classes: classStats, trend });
    } catch (error) {
        console.error("Overview Stats Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch stats" });
    }
};

// --- STUDENT PROFILE VIEWER (TEACHER ONLY) ---
exports.getStudentProfileForTeacher = async (req, res) => {
    try {
        const classId = req.params.id;
        const studentId = req.params.studentId;
        const teacherId = req.user.id;

        // The middleware requireTeacher already verified the user owns this class
        const classroom = req.classroom;
        if (!classroom) {
            return res.status(404).json({ success: false, message: "Class not found." });
        }

        // 2. Verify the student is actually enrolled in this class
        const isEnrolled = await Enrollment.findOne({ where: { user_id: studentId, class_id: classId } });
        if (!isEnrolled) {
            return res.status(404).json({ success: false, message: "Student is not enrolled in this class." });
        }

        // 2.5. Prevent teacher from viewing their own profile via this endpoint
        if (studentId === teacherId) {
            return res.status(400).json({ success: false, message: "You cannot view your own profile via this endpoint." });
        }

        // 3. Fetch the student's private profile data
        const student = await User.findByPk(studentId, {
            attributes: ['id', 'firstName', 'lastName', 'email', 'mobile', 'instituteId', 'dob']
        });
        if (!student) {
            return res.status(404).json({ success: false, message: "Student not found." });
        }

        // 4. Calculate detailed attendance using UNIQUE DAYS to ignore historical duplicates
        const { Op } = require('sequelize');

        // Fetch all valid sessions for the class
        const validSessions = await AttendanceSession.findAll({
            where: {
                class_id: classId,
                session_code: { [Op.ne]: 'CANCELLED' }
            },
            attributes: ['createdAt'] // We only need the date
        });

        // Use a Set to extract only unique calendar days
        const uniqueClassDates = new Set(validSessions.map(s => new Date(s.createdAt).toDateString()));
        const totalSessions = uniqueClassDates.size;

        // Fetch all the student's attendance logs for this class
        const attendedLogs = await AttendanceLog.findAll({
            where: { student_id: studentId },
            include: [{
                model: AttendanceSession,
                where: {
                    class_id: classId,
                    session_code: { [Op.ne]: 'CANCELLED' }
                },
                attributes: ['createdAt']
            }]
        });

        // Use a Set to extract only the unique days the student was present
        const uniqueAttendedDates = new Set(attendedLogs.map(log =>
            new Date(log.AttendanceSession.createdAt).toDateString()
        ));
        const attendedSessions = uniqueAttendedDates.size;

        res.json({
            success: true,
            student,
            attendance: { total: totalSessions, attended: attendedSessions }
        });

    } catch (error) {
        console.error("Student Profile Fetch Error:", error);
        res.status(500).json({ success: false, message: "Server error fetching student profile." });
    }
};