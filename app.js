const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const corsOptions = require('./config/cors');
const env = require('./config/env');

const app = express();
const authRoutes = require('./routes/authRoutes');
const classroomRoutes = require('./routes/classroomRoutes');

// --- 1. TRUST PROXY ---
app.set('trust proxy', 1);

// --- 2. SECURITY & PARSING MIDDLEWARE ---
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// --- 3. REQUEST LOGGING ---
app.use((req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} | IP: ${ip}`);
    next();
});

// --- 4. EXACT ROUTE REGISTRATION ---
// No try/catch. If these files throw errors (e.g., due to missing Sequelize models), 
// the server will crash on boot, which is exactly what we want.
app.use('/api/auth', authRoutes);
app.use('/api/classes', classroomRoutes);

// --- 5. HEALTH CHECK ---
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'SentryX Backend Running',
        timestamp: new Date().toISOString()
    });
});

// --- 6. 404 HANDLER ---
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// --- 7. CENTRALIZED ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${req.method} ${req.originalUrl} >>`, err.message);

    // Use the validated env configuration
    const isProduction = env.nodeEnv === 'production';

    res.status(err.status || 500).json({
        success: false,
        message: isProduction ? 'Internal Server Error' : err.message,
        ...(isProduction ? {} : { stack: err.stack })
    });
});

module.exports = app;