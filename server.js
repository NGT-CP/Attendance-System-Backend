const http = require('http');
const env = require('./config/env');
const app = require('./app');

const server = http.createServer(app);

// --- 1. REALTIME INFRASTRUCTURE ---
// No try/catch. Fail fast if socketHandler.js has Sequelize dependencies that break.
const socketHandler = require('./sockets/socketHandler');
const io = socketHandler(server);

app.set('socketio', io);
console.log('🔌 Socket.IO successfully attached to HTTP server.');

// --- 2. START SERVER ---
server.listen(env.port, () => {
  console.log(`\n🚀 SentryX API successfully started!`);
  console.log(`🌍 Environment: ${env.nodeEnv}`);
  console.log(`📡 Listening on Port: ${env.port}\n`);
});

// --- 3. SERVER LIFECYCLE & GRACEFUL SHUTDOWN ---
let isShuttingDown = false;

const gracefulShutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);

  const forceExit = setTimeout(() => {
    console.error('⚠️ Graceful shutdown timeout exceeded. Forcing exit.');
    process.exit(1);
  }, 10000);

  forceExit.unref();

  server.close(() => {
    console.log('✅ HTTP server closed. No longer accepting connections.');

    const io = app.get('socketio');
    if (io) {
      io.close(() => {
        console.log('✅ Socket.IO connections closed.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION! Shutting down...', err.name, err.message);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 UNHANDLED REJECTION! Shutting down...', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});