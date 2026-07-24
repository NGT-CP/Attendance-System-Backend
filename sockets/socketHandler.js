const { Server } = require('socket.io');
const env = require('../config/env');
const authenticateToken = require('../middleware/auth'); // ⚠️ MIGRATION BLOCKER

module.exports = (server) => {
    // ✅ Keep your exact local fallback alongside the validated Vercel URL
    const allowedOrigins = [
        env.frontendUrl,
        'http://localhost:3000'
    ].filter(Boolean);

    // Initialize with your exact custom timeouts and transport settings
    const io = new Server(server, {
        cors: {
            origin: allowedOrigins,
            methods: ["GET", "POST"],
            credentials: true // Important for secure sockets with HttpOnly cookies/tokens
        },
        transports: ['polling', 'websocket'],
        pingTimeout: 60000,
        pingInterval: 25000,
        upgradeTimeout: 30000,
        allowEIO3: true
    });

    // 🛡️ Socket Authentication
    // Note: If verifySocket relies on Sequelize, it will fail until middleware/auth.js is migrated.
    io.use(authenticateToken.verifySocket);

    io.on('connection', (socket) => {

        // 1. Room joining
        socket.on('join_class_room', (classId) => {
            socket.join(`class_${classId}`);
        });

        // 2. Chat relay (DB insert assumed to happen via REST API)
        socket.on('send_message', (data) => {
            io.to(`class_${data.classId}`).emit('receive_message', data);
        });

        // 3. Live attendance counter relay
        socket.on('attendance_marked', (classId) => {
            io.to(`class_${classId}`).emit('update_attendance_count');
        });

        socket.on('disconnect', () => {
            // Optional: log or handle cleanup
        });
    });

    return io;
};