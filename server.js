const express = require('express');
require('dotenv').config();
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Validate environment variables FIRST, before loading any other modules
const validateEnv = () => {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'FRONTEND_URL'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`CRITICAL: Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
};
validateEnv();

const { sequelize } = require('./models');
const authRoutes = require('./routes/authRoutes');
const classRoutes = require('./routes/classRoutes');

const app = express();
const http = require('http');
const server = http.createServer(app);
const socketHandler = require('./socketHandler');
const io = socketHandler(server);
app.set('socketio', io);

// --- DEBUG LOGGING + REQUEST TRACING ---
const requestLogger = (req, res, next) => {
  const userId = req.user?.id || 'anonymous';
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip;
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} user=${userId} ip=${ip}`);

  if (req.params && Object.keys(req.params).length > 0) {
    console.log('  params:', JSON.stringify(req.params));
  }
  if (req.query && Object.keys(req.query).length > 0) {
    console.log('  query:', JSON.stringify(req.query));
  }
  if (req.body && Object.keys(req.body).length > 0) {
    // 🛡️ SECURITY PATCH: Mask passwords before logging
    const safeBody = { ...req.body };
    if (safeBody.password) safeBody.password = '***MASKED***';
    if (safeBody.currentPassword) safeBody.currentPassword = '***MASKED***';
    if (safeBody.newPassword) safeBody.newPassword = '***MASKED***';
    console.log('  body:', JSON.stringify(safeBody));
  }
  next();
};

app.use(requestLogger);
// 🛡️ SECURITY: Content Security Policy (CSP) to prevent XSS
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", process.env.FRONTEND_URL || "http://localhost:3000"]
    },
  },
  crossOriginEmbedderPolicy: false
}));

// ✅ Accept BOTH Localhost (for dev) and Vercel (for production)
const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:3000'].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-device-fingerprint']
}));

app.use(express.json());

// 🛡️ SECURITY: Global API Limiter (Generous limit for normal app usage)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150,
  message: { success: false, message: "Too many requests, please try again later." }
});
app.use('/api/', globalLimiter);

// 🛡️ SECURITY: Strict Auth Limiter (Prevents Brute Force Password Guessing)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  message: { success: false, message: "Too many login attempts. Please wait 15 minutes." }
});

// Apply routes
app.use('/api/auth', authLimiter, authRoutes); // Apply strict limiter to auth
app.use('/api/classes', classRoutes);

sequelize.sync()
  .then(() => {
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => console.error('❌ Database Connection Error:', err));