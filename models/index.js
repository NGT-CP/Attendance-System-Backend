const sequelize = require('../config/database');
const User = require('./User');
const Classroom = require('./Classroom');
const Enrollment = require('./Enrollment');
const Notice = require('./Notice');
const ChatMessage = require('./ChatMessage');
const AttendanceSession = require('./AttendanceSession');
const AttendanceLog = require('./AttendanceLog');
const ActivityLog = require('./ActivityLog');

// --- 1. User & Classroom (The Teacher) ---
User.hasMany(Classroom, { foreignKey: 'owner_id' });
Classroom.belongsTo(User, { foreignKey: 'owner_id' });

// --- 2. User & Classroom (The Students) ---
User.belongsToMany(Classroom, { through: Enrollment, foreignKey: 'user_id' });
Classroom.belongsToMany(User, { through: Enrollment, foreignKey: 'class_id' });

// --- 2.5 The Missing Link for the Roster ---
Enrollment.belongsTo(User, { foreignKey: 'user_id' });
Enrollment.belongsTo(Classroom, { foreignKey: 'class_id' });

// --- 3. Notices & Chat Messages ---
Classroom.hasMany(Notice, { foreignKey: 'class_id' });
Notice.belongsTo(Classroom, { foreignKey: 'class_id' });

// Notice Author
User.hasMany(Notice, { foreignKey: 'author_id' });
Notice.belongsTo(User, { as: 'Author', foreignKey: 'author_id' });

// Chats in a Notice
Notice.hasMany(ChatMessage, { foreignKey: 'notice_id' });
ChatMessage.belongsTo(Notice, { foreignKey: 'notice_id' });

// Chat Sender
User.hasMany(ChatMessage, { foreignKey: 'sender_id' });
ChatMessage.belongsTo(User, { as: 'Sender', foreignKey: 'sender_id' });

// --- 4. Attendance Engine ---
Classroom.hasMany(AttendanceSession, { foreignKey: 'class_id' });
AttendanceSession.belongsTo(Classroom, { foreignKey: 'class_id' });

AttendanceSession.hasMany(AttendanceLog, { foreignKey: 'session_id' });
AttendanceLog.belongsTo(AttendanceSession, { foreignKey: 'session_id' });

// Which student logged the attendance
User.hasMany(AttendanceLog, { foreignKey: 'student_id' });
AttendanceLog.belongsTo(User, { foreignKey: 'student_id' });

User.hasMany(ActivityLog, { foreignKey: 'user_id' });
ActivityLog.belongsTo(User, { foreignKey: 'user_id' });

Classroom.hasMany(ActivityLog, { foreignKey: 'class_id' });
ActivityLog.belongsTo(Classroom, { foreignKey: 'class_id' });

module.exports = {
    sequelize,
    User,
    Classroom,
    Enrollment,
    Notice,
    ChatMessage,
    AttendanceSession,
    AttendanceLog,
    ActivityLog
};