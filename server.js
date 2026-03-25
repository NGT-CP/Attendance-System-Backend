const express = require('express');
require('dotenv').config();
const cors = require('cors');
const rateLimit = require('express-rate-limit'); // ✅ NEW
const { sequelize } = require('./models');

const authRoutes = require('./routes/authRoutes');
const classRoutes = require('./routes/classRoutes');

const app = express();
const http = require('http');
const server = http.createServer(app);
const socketHandler = require('./socketHandler');
const io = socketHandler(server);
app.set('socketio', io);

// ✅ Fix #13: Use ENV for CORS
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000" }));
app.use(express.json());

// ✅ Fix #7: Add Rate Limiting (Max 100 requests per 15 mins per IP)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: "Too many requests, please try again later." }
});
app.use('/api/', limiter);

app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);

// ✅ Fix #6: Remove { alter: true } for production safety
sequelize.sync()
  .then(() => {
    console.log('✅ SQL Database Synced');
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => console.error('❌ Database Connection Error:', err));