const jwt = require('jsonwebtoken');

// --- 1. HTTP ROUTE MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
        return res.status(500).json({ message: "CRITICAL: JWT_SECRET is not configured" });
    }

    let token;

    // 🛡️ HIGH FIX: Support BOTH Bearer tokens (for backwards compatibility) and HTTP-only cookies
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.split(' ')[1]) {
        token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
        // 🛡️ HIGH FIX: Get token from HTTP-only cookie
        token = req.cookies.token;
    }

    if (!token) return res.status(401).json({ message: "Access Denied: No token provided" });

    jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
        if (err) return res.status(403).json({ message: "Invalid or expired token" });
        req.user = decodedUser;
        next();
    });
};

// --- 2. WEBSOCKET MIDDLEWARE (NEW) ---
authenticateToken.verifySocket = (socket, next) => {
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
        return next(new Error("Authentication error: JWT_SECRET is not configured"));
    }

    // 🛡️ HIGH FIX: Read token from cookies instead of manual auth field
    // Browser automatically sends HTTP-only cookies with socket connection when credentials: true
    let token = socket.handshake.auth?.token;
    
    // If no token in auth field, try to extract from headers
    if (!token && socket.handshake.headers?.cookie) {
        const cookies = socket.handshake.headers.cookie.split('; ').reduce((acc, cookie) => {
            const [key, value] = cookie.split('=');
            acc[key] = decodeURIComponent(value);
            return acc;
        }, {});
        token = cookies.token;
    }

    if (!token) {
        console.error("Socket auth failed: No token provided");
        return next(new Error("Authentication error: No token provided"));
    }

    jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
        if (err) {
            console.error("Socket auth failed: Token verification failed", err.message);
            return next(new Error("Authentication error: Invalid or expired token"));
        }
        socket.user = decodedUser;
        next();
    });
};

module.exports = authenticateToken;