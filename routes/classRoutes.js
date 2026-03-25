const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');

// Import Controllers
const classController = require('../controllers/classController');
const attendanceController = require('../controllers/attendanceController');
const noticeController = require('../controllers/noticeController');

// --- CLASSROOM DOMAIN ---
router.get('/my-classes', authenticateToken, classController.getMyClasses);
router.post('/create', authenticateToken, classController.createClass);
router.post('/join', authenticateToken, classController.joinClass);
router.get('/:id/dashboard-data', authenticateToken, classController.getDashboardData);
router.put('/:id/update', authenticateToken, classController.updateClass);
router.delete('/:id/delete', authenticateToken, classController.deleteClass);
router.post('/:id/regenerate-code', authenticateToken, classController.regenerateCode);
router.get('/overview-stats', authenticateToken, classController.getOverviewStats);

// --- ATTENDANCE DOMAIN ---
router.post('/:id/attendance/start', authenticateToken, attendanceController.startSession);
router.post('/:id/attendance/mark', authenticateToken, attendanceController.markAttendance);
router.post('/:id/attendance/cancel', authenticateToken, attendanceController.cancelSession);

// --- NOTICE & CHAT DOMAIN ---
router.post('/:id/notices', authenticateToken, noticeController.createNotice);
router.get('/my-notices', authenticateToken, noticeController.getMyNotices);
router.post('/notices/:noticeId/chat', authenticateToken, noticeController.addChat);

module.exports = router;