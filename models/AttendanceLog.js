const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const AttendanceLog = sequelize.define("AttendanceLog", {

    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },

    session_id: {
        type: DataTypes.UUID,
        allowNull: false
    },

    student_id: {
        type: DataTypes.UUID,
        allowNull: false
    },

    status: {
        type: DataTypes.ENUM("PRESENT", "ABSENT", "LATE")
    },

    student_lat: {
        type: DataTypes.FLOAT
    },

    student_long: {
        type: DataTypes.FLOAT
    },

    distance_verified: {
        type: DataTypes.BOOLEAN
    }

});

module.exports = AttendanceLog;