const supabase = require('../config/supabase');
const crypto = require('crypto');

// Helper to generate a random 6-character alphanumeric join code
const generateJoinCode = () => {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
};

// Helper to map snake_case users to camelCase for the frontend
const mapUserToCamelCase = (user) => {
    if (!user) return null;
    return {
        firstName: user.first_name,
        lastName: user.last_name,
        ...user
    };
};

// ==========================================
// GET MY CLASSES (Basic List)
// ==========================================
exports.getMyClasses = async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: enrolledData } = await supabase
            .from('enrollments')
            .select('classrooms(*, User:users!fk_classrooms_owner(id, first_name, last_name))')
            .eq('user_id', userId);

        const { data: ownedData } = await supabase
            .from('classrooms')
            .select('*, User:users!fk_classrooms_owner(id, first_name, last_name)')
            .eq('owner_id', userId);

        const classes = [
            ...(enrolledData ? enrolledData.map(e => e.classrooms) : []),
            ...(ownedData || [])
        ].filter(c => c !== null).map(cls => ({
            ...cls,
            User: mapUserToCamelCase(cls.User)
        }));

        res.json({ success: true, classes });
    } catch (error) {
        console.error("Get My Classes Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch classes" });
    }
};

// ==========================================
// CREATE A CLASS
// ==========================================
exports.createClass = async (req, res) => {
    try {
        const { class_name, subject, description } = req.body;
        const owner_id = req.user.id;

        if (!class_name) {
            return res.status(400).json({ success: false, message: "Class name is required" });
        }

        const join_code = generateJoinCode();

        const { data: newClass, error } = await supabase
            .from('classrooms')
            .insert([{
                class_name: class_name.trim(),
                subject: subject ? subject.trim() : null,
                description: description ? description.trim() : null,
                join_code,
                owner_id
            }])
            .select('*')
            .single();

        if (error) throw error;

        // Activity log is handled async without awaiting/blocking the response
        supabase.from('activity_logs').insert([{
            user_id: owner_id,
            activity_type: 'CREATE_CLASS',
            ip_address: req.ip
        }]).then();

        res.status(201).json({ success: true, classroom: newClass });
    } catch (error) {
        console.error("Create Class Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to create class" });
    }
};

// ==========================================
// JOIN A CLASS
// ==========================================
exports.joinClass = async (req, res) => {
    try {
        const { join_code } = req.body; // Adjusted to match your route req.body
        const user_id = req.user.id;

        if (!join_code) return res.status(400).json({ success: false, message: "Join code is required" });

        const { data: classroom, error: classError } = await supabase
            .from('classrooms')
            .select('id, owner_id')
            .eq('join_code', join_code.trim().toUpperCase())
            .maybeSingle();

        if (classError || !classroom) {
            return res.status(404).json({ success: false, message: "Invalid class code. Please try again." });
        }

        if (classroom.owner_id === user_id) {
            return res.status(400).json({ success: false, message: "You cannot join your own class" });
        }

        const { error: enrollError } = await supabase
            .from('enrollments')
            .insert([{ user_id, class_id: classroom.id }]);

        if (enrollError) {
            if (enrollError.code === '23505') {
                return res.status(400).json({ success: false, message: "You are already enrolled in this class!" });
            }
            throw enrollError;
        }

        supabase.from('activity_logs').insert([{
            user_id: user_id,
            activity_type: 'JOIN_CLASS',
            ip_address: req.ip
        }]).then();

        res.json({ success: true, message: "Successfully joined class!" });
    } catch (error) {
        console.error("Join Class Error:", error.message);
        res.status(500).json({ success: false, message: "Server error joining class" });
    }
};

// ==========================================
// UPDATE CLASS
// ==========================================
exports.updateClass = async (req, res) => {
    try {
        const { class_name } = req.body;
        if (!class_name) return res.status(400).json({ success: false, message: "Class name required" });

        const { error } = await supabase
            .from('classrooms')
            .update({ class_name: class_name.trim() })
            .eq('id', req.params.id)
            .eq('owner_id', req.user.id);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error("Update Class Error:", error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// ==========================================
// REGENERATE CODE
// ==========================================
exports.regenerateCode = async (req, res) => {
    try {
        const new_code = generateJoinCode();
        const { error } = await supabase
            .from('classrooms')
            .update({ join_code: new_code })
            .eq('id', req.params.id)
            .eq('owner_id', req.user.id);

        if (error) throw error;
        res.json({ success: true, new_code });
    } catch (error) {
        console.error("Regenerate Code Error:", error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// ==========================================
// DELETE CLASS
// ==========================================
exports.deleteClass = async (req, res) => {
    try {
        // PostgreSQL ON DELETE CASCADE handles all cleanup automatically
        const { error } = await supabase
            .from('classrooms')
            .delete()
            .eq('id', req.params.id)
            .eq('owner_id', req.user.id);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error("Delete Class Error:", error.message);
        res.status(500).json({ success: false, message: "Server error deleting class" });
    }
};

// ==========================================
// GET OVERVIEW STATS
// ==========================================
exports.getOverviewStats = async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: enrolledData } = await supabase
            .from('enrollments')
            .select('classrooms(*, User:users!fk_classrooms_owner(id, first_name, last_name))')
            .eq('user_id', userId);

        const { data: ownedData } = await supabase
            .from('classrooms')
            .select('*, User:users!fk_classrooms_owner(id, first_name, last_name)')
            .eq('owner_id', userId);

        const classes = [
            ...(enrolledData ? enrolledData.map(e => e.classrooms) : []),
            ...(ownedData || [])
        ].filter(c => c !== null);

        const classIds = classes.map(c => c.id);

        if (classIds.length === 0) return res.json({ success: true, classes: [], trend: [] });

        const { data: allSessions } = await supabase
            .from('attendance_sessions')
            .select('*')
            .in('class_id', classIds);

        const { data: allLogs } = await supabase
            .from('attendance_logs')
            .select('session_id, attendance_sessions!inner(created_at)')
            .eq('student_id', userId);

        const classStats = classes.map(cls => {
            const clsSessions = (allSessions || []).filter(s => s.class_id === cls.id && s.session_code !== 'CANCELLED');
            const uniqueDates = new Set(clsSessions.map(s => new Date(s.created_at).toDateString()));
            const total = uniqueDates.size;

            const clsLogs = (allLogs || []).filter(l => clsSessions.some(s => s.id === l.session_id));
            const attendedDates = new Set(clsLogs.map(l => new Date(l.attendance_sessions.created_at).toDateString()));
            const attended = attendedDates.size;

            return {
                ...cls,
                User: mapUserToCamelCase(cls.User),
                attendancePercent: total === 0 ? 0 : Math.floor((attended / total) * 100)
            };
        });

        const monthlyStats = {};
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            monthlyStats[monthNames[d.getMonth()]] = { total: 0, attended: 0 };
        }

        (allSessions || []).forEach(session => {
            if (session.session_code === 'CANCELLED') return;
            const monthName = monthNames[new Date(session.created_at).getMonth()];
            if (monthlyStats[monthName]) monthlyStats[monthName].total += 1;
        });

        (allLogs || []).forEach(log => {
            const monthName = monthNames[new Date(log.attendance_sessions.created_at).getMonth()];
            if (monthlyStats[monthName]) monthlyStats[monthName].attended += 1;
        });

        const trend = Object.keys(monthlyStats).map(month => {
            const stat = monthlyStats[month];
            return { month, attendance: stat.total === 0 ? 0 : Math.floor((stat.attended / stat.total) * 100) };
        });

        res.json({ success: true, classes: classStats, trend });
    } catch (error) {
        console.error("Overview Stats Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to fetch stats" });
    }
};

// ==========================================
// GET CLASS DASHBOARD DATA
// ==========================================
exports.getDashboardData = async (req, res) => {
    try {
        const classId = req.params.id;
        const userId = req.user.id;

        const { data: classroom } = await supabase
            .from('classrooms')
            .select('*, teacher:users!fk_classrooms_owner(id, first_name, last_name)')
            .eq('id', classId)
            .maybeSingle();

        if (!classroom) return res.status(404).json({ success: false, message: "Class not found" });

        const isTeacher = classroom.owner_id === userId;

        if (!isTeacher) {
            const { data: isEnrolled } = await supabase
                .from('enrollments')
                .select('id')
                .eq('user_id', userId)
                .eq('class_id', classId)
                .maybeSingle();

            if (!isEnrolled) return res.status(403).json({ success: false, message: "Access Denied." });
        }

        // Fetch Notices mapped cleanly for React
        const { data: noticesData } = await supabase
            .from('notices')
            .select(`
                *,
                Author:users!fk_notices_author(first_name, last_name),
                ChatMessages:chat_messages(
                    *,
                    Sender:users!fk_chat_sender(first_name, last_name)
                )
            `)
            .eq('class_id', classId)
            .order('created_at', { ascending: false });

        const formattedNotices = (noticesData || []).map(notice => ({
            ...notice,
            Author: mapUserToCamelCase(notice.Author),
            ChatMessages: (notice.ChatMessages || []).map(msg => ({
                ...msg,
                Sender: mapUserToCamelCase(msg.Sender)
            }))
        }));

        // Strict Attendance Filtering
        const { data: rawSessions } = await supabase
            .from('attendance_sessions')
            .select('*')
            .eq('class_id', classId)
            .order('created_at', { ascending: false });

        const uniqueSessionsMap = new Map();
        (rawSessions || []).forEach(session => {
            const dateStr = new Date(session.created_at).toDateString();
            // 🛡️ NEW CODE: rawSessions is already sorted newest-first. 
            // Just take the first thing we see for the day, whatever it is.
            if (!uniqueSessionsMap.has(dateStr)) {
                uniqueSessionsMap.set(dateStr, session);
            }
        });

        const finalValidSessions = Array.from(uniqueSessionsMap.values());
        const validSessionsForPercent = finalValidSessions.filter(s => s.session_code !== 'CANCELLED');
        const uniqueClassDates = new Set(validSessionsForPercent.map(s => new Date(s.created_at).toDateString()));
        const totalSessions = uniqueClassDates.size;

        let myAttendance = [];
        let studentPercent = 100;

        if (!isTeacher) {
            const { data: logs } = await supabase
                .from('attendance_logs')
                .select('*, AttendanceSession:attendance_sessions!inner(*)')
                .eq('student_id', userId)
                .eq('attendance_sessions.class_id', classId);
            myAttendance = logs || [];

            if (totalSessions > 0) {
                const uniqueStudentAttendedDates = new Set(myAttendance.map(log => new Date(log.AttendanceSession.created_at).toDateString()));
                studentPercent = Math.floor((uniqueStudentAttendedDates.size / totalSessions) * 100);
            }
        } else {
            studentPercent = null;
        }

        // Roster Math
        const { data: enrollments } = await supabase
            .from('enrollments')
            .select('user_id, users!fk_enrollments_user(first_name, last_name)')
            .eq('class_id', classId);

        const { data: allLogs } = await supabase
            .from('attendance_logs')
            .select('student_id, attendance_sessions!inner(created_at, session_code)')
            .eq('attendance_sessions.class_id', classId)
            .neq('attendance_sessions.session_code', 'CANCELLED');

        const logCounts = {};
        (allLogs || []).forEach(log => {
            const dateStr = new Date(log.attendance_sessions.created_at).toDateString();
            if (!logCounts[log.student_id]) logCounts[log.student_id] = new Set();
            logCounts[log.student_id].add(dateStr);
        });

        const rosterData = (enrollments || []).map(enr => {
            if (enr.user_id === classroom.owner_id) return null;
            const attendedCount = logCounts[enr.user_id] ? logCounts[enr.user_id].size : 0;
            return {
                id: enr.user_id,
                name: `${enr.users.first_name} ${enr.users.last_name}`,
                percent: isTeacher ? (totalSessions === 0 ? 0 : Math.floor((attendedCount / totalSessions) * 100)) : null
            };
        }).filter(r => r !== null);

        const fullRoster = [
            { id: classroom.owner_id, name: `${classroom.teacher.first_name} ${classroom.teacher.last_name}`, isTeacher: true, percent: 100 },
            ...rosterData
        ];

        res.json({
            success: true,
            classroom,
            notices: formattedNotices,
            attendance: myAttendance,
            allSessions: finalValidSessions,
            roster: fullRoster,
            studentAttendancePercent: studentPercent
        });
    } catch (error) {
        console.error("Dashboard Data Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to fetch data" });
    }
};

// ==========================================
// STUDENT PROFILE FOR TEACHER
// ==========================================
exports.getStudentProfileForTeacher = async (req, res) => {
    try {
        const classId = req.params.id;
        const studentId = req.params.studentId;
        const teacherId = req.user.id;

        // 1. Double verify teacher owns the class
        const { data: classroom } = await supabase
            .from('classrooms')
            .select('owner_id')
            .eq('id', classId)
            .maybeSingle();

        if (!classroom || classroom.owner_id !== teacherId) {
            return res.status(403).json({ success: false, message: "Unauthorized access" });
        }

        if (studentId === teacherId) {
            return res.status(400).json({ success: false, message: "Cannot view your own profile." });
        }

        // 2. Fetch student details
        const { data: student } = await supabase
            .from('users')
            .select('id, first_name, last_name, email, mobile, institute_id, dob')
            .eq('id', studentId)
            .maybeSingle();

        if (!student) return res.status(404).json({ success: false, message: "Student not found." });

        // 3. Math for unique class dates
        const { data: validSessions } = await supabase
            .from('attendance_sessions')
            .select('created_at')
            .eq('class_id', classId)
            .neq('session_code', 'CANCELLED');

        const uniqueClassDates = new Set((validSessions || []).map(s => new Date(s.created_at).toDateString()));
        const totalSessions = uniqueClassDates.size;

        // 4. Math for unique attended dates
        const { data: attendedLogs } = await supabase
            .from('attendance_logs')
            .select('attendance_sessions!inner(created_at, session_code)')
            .eq('student_id', studentId)
            .eq('attendance_sessions.class_id', classId)
            .neq('attendance_sessions.session_code', 'CANCELLED');

        const uniqueAttendedDates = new Set((attendedLogs || []).map(log => new Date(log.attendance_sessions.created_at).toDateString()));
        const attendedSessions = uniqueAttendedDates.size;
        const presentDates = Array.from(uniqueAttendedDates).sort();

        const formattedStudent = {
            id: student.id,
            firstName: student.first_name,
            lastName: student.last_name,
            email: student.email,
            mobile: student.mobile,
            instituteId: student.institute_id,
            dob: student.dob
        };

        res.json({
            success: true,
            student: formattedStudent,
            attendance: { total: totalSessions, attended: attendedSessions },
            presentDates
        });

    } catch (error) {
        console.error("Student Profile Fetch Error:", error.message);
        res.status(500).json({ success: false, message: "Server error fetching student profile." });
    }
};