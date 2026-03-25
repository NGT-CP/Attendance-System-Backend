const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'mysql',
    dialectOptions: {
        ssl: {
            require: true,               // Force SSL
            rejectUnauthorized: false    // This bypasses local certificate issues
        }
    },
    logging: console.log // This will show us EXACTLY what the server is doing
});

module.exports = sequelize;