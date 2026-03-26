const express = require('express');
require('dotenv').config();
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { sequelize } = require('./models');

const authRoutes = require('./routes/authRoutes');
const classRoutes = require('./routes/classRoutes');

const app = express();
const http = require('http');
const server = http.createServer(app);
const socketHandler = require('./socketHandler');
const io = socketHandler(server);
app.set('socketio', io);

// ✅ FIX 2: Synchronized CORS Origin for both Express and WebSockets
const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:3000";
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: "Too many requests, please try again later." }
});
app.use('/api/', limiter);

app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);

sequelize.sync()
  .then(() => {
    console.log('✅ SQL Database Synced');
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => console.error('❌ Database Connection Error:', err));