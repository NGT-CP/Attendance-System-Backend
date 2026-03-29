const socketIo = require('socket.io');
const authenticateToken = require('./middleware/auth');

module.exports = (server) => {
    // ✅ Allow both URLs for WebSockets too
    const allowedOrigins = [
        process.env.FRONTEND_URL,
        'http://localhost:3000'
    ].filter(Boolean);

    const io = socketIo(server, {
        cors: {
            origin: allowedOrigins,
            methods: ["GET", "POST"],
            credentials: true // Important for secure sockets
        },
        transports: ['polling', 'websocket'],
        pingTimeout: 60000,
        pingInterval: 25000,
        upgradeTimeout: 30000,
        allowEIO3: true
    });

    io.use(authenticateToken.verifySocket);

    io.on('connection', (socket) => {
        socket.on('join_class_room', (classId) => {
            socket.join(`class_${classId}`);
        });

        socket.on('send_message', (data) => {
            io.to(`class_${data.classId}`).emit('receive_message', data);
        });

        socket.on('attendance_marked', (classId) => {
            io.to(`class_${classId}`).emit('update_attendance_count');
        });
    });

    return io;
};