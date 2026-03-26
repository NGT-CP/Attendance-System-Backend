const socketIo = require('socket.io');
const authenticateToken = require('./middleware/auth');

module.exports = (server) => {
    const io = socketIo(server, {
        cors: {
            origin: process.env.FRONTEND_URL || "http://localhost:3000",
            methods: ["GET", "POST"]
        },
        // ✅ The Render Proxy Survival Kit
        transports: ['polling', 'websocket'],
        pingTimeout: 60000,       // Gives Render 60 seconds to respond before dropping
        pingInterval: 25000,      // Checks connection every 25 seconds
        upgradeTimeout: 30000,    // Gives extra time to switch from HTTP to WebSocket
        allowEIO3: true
    });

    io.use(authenticateToken.verifySocket);

    io.on('connection', (socket) => {
        console.log(`🔌 Secure client connected: ${socket.id}`);

        socket.on('join_class_room', (classId) => {
            socket.join(`class_${classId}`);
            console.log(`User joined room: class_${classId}`);
        });

        socket.on('send_message', (data) => {
            console.log(`Broadcasting chat update to room: class_${data.classId}`);
            io.to(`class_${data.classId}`).emit('receive_message', data);
        });

        socket.on('attendance_marked', (classId) => {
            console.log(`Broadcasting attendance update to room: class_${classId}`);
            io.to(`class_${classId}`).emit('update_attendance_count');
        });

        socket.on('disconnect', () => {
            console.log(`🔌 Client disconnected: ${socket.id}`);
        });
    });

    return io;
};