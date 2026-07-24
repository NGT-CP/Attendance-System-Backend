const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const requireTeacher = require('../middleware/roleAuth');

// Import Controllers
const classController = require('../controllers/classController');
const attendanceController = require('../controllers/attendanceController');
const noticeController = require('../controllers/noticeController');

const rateLimit = require('express-rate-limit');

// 🛡️ SECURITY: Prevent brute-forcing class join codes
const joinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { success: false, message: "Too many join attempts. Please wait 15 minutes." }
});

// 🛡️ SECURITY: HIGH FIX - Prevent brute-forcing attendance codes
const attendanceCodeLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 5, // 5 attempts per minute
    keyGenerator: (req) => `${req.user?.id || 'anonymous'}-${req.params.id}`, // per student per class
    message: { success: false, message: "Too many attendance attempts. Try again later." }
});

// --- CLASSROOM DOMAIN ---
router.get('/my-classes', authenticateToken, classController.getMyClasses);
router.post('/create', authenticateToken, classController.createClass);
router.post('/join', authenticateToken, joinLimiter, classController.joinClass);
router.get('/:id/dashboard-data', authenticateToken, classController.getDashboardData);
router.get('/:id/student/:studentId', authenticateToken, requireTeacher, classController.getStudentProfileForTeacher);
router.put('/:id/update', authenticateToken, classController.updateClass);
router.delete('/:id/delete', authenticateToken, classController.deleteClass);
router.post('/:id/regenerate-code', authenticateToken, classController.regenerateCode);
router.get('/overview-stats', authenticateToken, classController.getOverviewStats);

// --- ATTENDANCE DOMAIN ---
router.post('/:id/attendance/start', authenticateToken, attendanceController.startSession);
router.post('/:id/attendance/mark', authenticateToken, attendanceCodeLimiter, attendanceController.markAttendance); // 🛡️ HIGH FIX: Apply rate limiter
router.post('/:id/attendance/cancel', authenticateToken, attendanceController.cancelSession);

// --- NOTICE & CHAT DOMAIN ---
router.post('/:id/notices', authenticateToken, noticeController.createNotice);
router.get('/my-notices', authenticateToken, noticeController.getMyNotices);
router.post('/notices/:noticeId/chat', authenticateToken, noticeController.addChat);

// --- NOTICE MODERATION (teacher) ---
router.put('/notices/:noticeId', authenticateToken, noticeController.updateNotice);
router.delete('/notices/:noticeId', authenticateToken, noticeController.deleteNotice);
router.put('/notices/:noticeId/chat-enabled', authenticateToken, noticeController.setChatEnabled);

// --- CHAT MODERATION (student within 15 min) ---
router.put('/notices/chat/:chatId', authenticateToken, noticeController.updateChat);
router.delete('/notices/chat/:chatId', authenticateToken, noticeController.deleteChat);

module.exports = router;