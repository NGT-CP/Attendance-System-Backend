const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Classroom = sequelize.define('Classroom', {

    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },

    class_name: {
        type: DataTypes.STRING,
        allowNull: false
    },

    join_code: {
        type: DataTypes.STRING,
        unique: true
    },

    owner_id: {
        type: DataTypes.UUID,
        allowNull: false
    },

    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }

});

module.exports = Classroom;