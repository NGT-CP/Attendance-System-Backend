const socketIo = require('socket.io');
const authenticateToken = require('./middleware/auth'); // ✅ Import from auth.js

module.exports = (server) => {
    const io = socketIo(server, {
        cors: { origin: process.env.FRONTEND_URL || "http://localhost:3000", methods: ["GET", "POST"] }
    });

    // 🛡️ SECURITY: Use the centralized auth logic!
    io.use(authenticateToken.verifySocket);

    io.on('connection', (socket) => {
        console.log(`🔌 Secure client connected: ${socket.id} (User ID: ${socket.user.id})`);

        socket.on('join_class_room', (classId) => {
            socket.join(`class_${classId}`);
        });

        socket.on('send_message', (data) => {
            io.to(`class_${data.classId}`).emit('receive_message', data);
        });

        socket.on('attendance_marked', (classId) => {
            io.to(`class_${classId}`).emit('update_attendance_count');
        });

        socket.on('disconnect', () => {
            console.log(`🔌 Client disconnected: ${socket.id}`);
        });
    });

    return io;
};