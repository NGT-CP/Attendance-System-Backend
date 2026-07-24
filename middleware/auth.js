const jwt = require('jsonwebtoken');
const env = require('../config/env'); // Import the validated environment config

// --- 1. HTTP ROUTE MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    let token;

    // 🛡️ Support BOTH Bearer tokens (for standard API calls) and HTTP-only cookies
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Access Denied: No token provided"
        });
    }

    // Verify token using the globally validated secret
    jwt.verify(token, env.jwtSecret, (err, decodedUser) => {
        if (err) {
            return res.status(403).json({
                success: false,
                message: "Invalid or expired token"
            });
        }

        req.user = decodedUser;
        next();
    });
};

// --- 2. WEBSOCKET MIDDLEWARE ---
authenticateToken.verifySocket = (socket, next) => {
    let token = socket.handshake.auth?.token;

    // If no token in the auth payload, extract it from the HTTP-only cookie header
    // Browsers automatically send cookies with socket connections if credentials: true is set
    if (!token && socket.handshake.headers?.cookie) {
        const cookies = socket.handshake.headers.cookie.split('; ').reduce((acc, cookie) => {
            const [key, value] = cookie.split('=');
            acc[key] = decodeURIComponent(value);
            return acc;
        }, {});

        token = cookies.token;
    }

    if (!token) {
        console.error("[Socket Auth] Failed: No token provided");
        return next(new Error("Authentication error: No token provided"));
    }

    jwt.verify(token, env.jwtSecret, (err, decodedUser) => {
        if (err) {
            console.error("[Socket Auth] Failed: Invalid token");
            return next(new Error("Authentication error: Invalid or expired token"));
        }

        // Attach the decoded user payload to the socket instance for future events
        socket.user = decodedUser;
        next();
    });
};

module.exports = authenticateToken;