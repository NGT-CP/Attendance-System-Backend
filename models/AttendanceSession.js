const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const AttendanceSession = sequelize.define("AttendanceSession", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    class_id: { type: DataTypes.UUID, allowNull: false },
    session_code: { type: DataTypes.STRING, allowNull: false },
    teacher_lat: { type: DataTypes.FLOAT },
    teacher_long: { type: DataTypes.FLOAT },
    require_gps: { type: DataTypes.BOOLEAN, defaultValue: true }, // NEW: Checkbox setting
    expires_at: { type: DataTypes.DATE },                          // NEW: 2-Minute Timer
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true }
});

module.exports = AttendanceSession;