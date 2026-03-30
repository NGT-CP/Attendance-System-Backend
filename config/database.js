const { Sequelize } = require('sequelize');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
    console.error('CRITICAL: DATABASE_URL environment variable is not set. Please configure it before starting the server.');
    process.exit(1);
}

const enableDbLogging = process.env.DB_LOGGING === 'true' || process.env.NODE_ENV !== 'production';

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'mysql',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    },
    logging: enableDbLogging ? (msg) => console.log(`[Sequelize] ${msg}`) : false
});

module.exports = sequelize;