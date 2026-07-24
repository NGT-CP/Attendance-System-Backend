const dotenv = require("dotenv");
const path = require("path");

// Load .env.local for local development.
// Azure production environment variables are injected by the platform.
if (process.env.NODE_ENV !== "production") {
    dotenv.config({
        path: path.resolve(process.cwd(), ".env.local"),
    });
}

const requiredVariables = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "JWT_SECRET",
    "FRONTEND_URL",
    "NODE_ENV",
    "PORT",
];

const missingVariables = requiredVariables.filter(
    (variable) => !process.env[variable]
);

if (missingVariables.length > 0) {
    throw new Error(
        `CRITICAL ERROR: Missing required environment variables: ${missingVariables.join(", ")}`
    );
}

module.exports = {
    nodeEnv: process.env.NODE_ENV,
    port: parseInt(process.env.PORT, 10),
    frontendUrl: process.env.FRONTEND_URL,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: process.env.JWT_SECRET,
};