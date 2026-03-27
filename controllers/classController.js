const { Classroom, Enrollment, User, AttendanceSession, AttendanceLog, ActivityLog, Notice, ChatMessage } = require('../models');

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
        if (!class_name) return res.status(400).json({ message: "Class name is required" });

        const generateCode = () => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let code = '';
            for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
            return code;
        };

        let join_code = generateCode();
        let isUnique = false;
        while (!isUnique) {
            const existingClass = await Classroom.findOne({ where: { join_code } });
            if (!existingClass) isUnique = true;
            else join_code = generateCode();
        }

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

        if (!join_code) return res.status(400).json({ message: "Join code is required" });

        const classroom = await Classroom.findOne({ where: { join_code } });
        if (!classroom) return res.status(404).json({ message: "Invalid class code. Please try again." });

        const existingEnrollment = await Enrollment.findOne({ where: { user_id: userId, class_id: classroom.id } });
        if (existingEnrollment) return res.status(400).json({ message: "You are already enrolled in this class!" });

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

        const notices = await Notice.findAll({
            where: { class_id: classId },
            include: [
                { model: User, as: 'Author', attributes: ['firstName', 'lastName'] },
                { model: ChatMessage, include: [{ model: User, as: 'Sender', attributes: ['firstName', 'lastName'] }], order: [['createdAt', 'ASC']] }
            ],
            order: [['createdAt', 'DESC']]
        });

        const allSessions = await AttendanceSession.findAll({ where: { class_id: classId } });
        const validSessions = allSessions.filter(s => s.session_code !== 'CANCELLED');
        const totalSessions = validSessions.length;

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
            return {
                id: student.id,
                name: `${student.firstName} ${student.lastName}`,
                percent: totalSessions === 0 ? 0 : Math.round((attendedCount / totalSessions) * 100)
            };
        });

        const cleanRoster = rosterData.filter(r => r !== null);
        const teacher = await User.findByPk(classroom.owner_id);
        const fullRoster = [{ id: teacher.id, name: `${teacher.firstName} ${teacher.lastName}`, isTeacher: true }, ...cleanRoster];

        res.json({ success: true, classroom, notices, attendance: myAttendance, allSessions, roster: fullRoster });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch data" });
    }
};

exports.updateClass = async (req, res) => {
    try {
        const classroom = await Classroom.findByPk(req.params.id);
        if (!classroom) return res.status(404).json({ message: "Class Not found" });
        if (classroom.owner_id !== req.user.id) return res.status(403).json({ message: "Admin only Access" });

        classroom.class_name = req.body.class_name;
        await classroom.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Server error" }); }
};

exports.deleteClass = async (req, res) => {
    try {
        const classroom = await Classroom.findByPk(req.params.id);
        if (!classroom) return res.status(404).json({ message: "Not found" });
        if (classroom.owner_id !== req.user.id) return res.status(403).json({ message: "Not allowed" });

        await classroom.destroy();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Server error" }); }
};

exports.regenerateCode = async (req, res) => {
    try {
        const classroom = await Classroom.findByPk(req.params.id);
        if (!classroom) return res.status(404).json({ message: "Class Not found" });
        if (classroom.owner_id !== req.user.id) return res.status(403).json({ message: "Admin only Access" });

        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let new_code = '';
        for (let i = 0; i < 6; i++) new_code += chars.charAt(Math.floor(Math.random() * chars.length));

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
        const allLogs = await AttendanceLog.findAll({ where: { student_id: userId } });

        const classStats = classes.map(cls => {
            const clsSessions = allSessions.filter(s => s.class_id === cls.id && s.session_code !== 'CANCELLED');
            const clsLogs = allLogs.filter(l => clsSessions.some(s => s.id === l.session_id));
            const total = clsSessions.length;
            const attended = clsLogs.length;
            return { ...cls.toJSON(), attendancePercent: total === 0 ? 0 : Math.round((attended / total) * 100) };
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
            const monthName = monthNames[new Date(log.createdAt).getMonth()];
            if (monthlyStats[monthName]) monthlyStats[monthName].attended += 1;
        });

        const trend = Object.keys(monthlyStats).map(month => {
            const stat = monthlyStats[month];
            return { month, attendance: stat.total === 0 ? 0 : Math.round((stat.attended / stat.total) * 100) };
        });

        res.json({ success: true, classes: classStats, trend });
    } catch (error) {
        console.error("Overview Stats Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch stats" });
    }
};