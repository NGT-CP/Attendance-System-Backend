const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'gama_super_secret_key';

// --- 1. HTTP ROUTE MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: "Access Denied: No token provided" });

    jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
        if (err) return res.status(403).json({ message: "Invalid or expired token" });
        req.user = decodedUser;
        next();
    });
};

// --- 2. WEBSOCKET MIDDLEWARE (NEW) ---
authenticateToken.verifySocket = (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error: No token provided"));

    jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
        if (err) return next(new Error("Authentication error: Invalid or expired token"));
        socket.user = decodedUser;
        next();
    });
};

module.exports = authenticateToken;