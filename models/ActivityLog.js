const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const ActivityLog = sequelize.define("ActivityLog", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    class_id: { type: DataTypes.UUID, allowNull: true },
    user_id: { type: DataTypes.UUID, allowNull: false },
    action: {
        type: DataTypes.ENUM(
            "LOGIN",
            "JOIN_CLASS",
            "CREATE_CLASS",
            "MARK_ATTENDANCE",
            "UPDATE_CLASS",
            "DELETE_CLASS"
        ),
        allowNull: false
    },
    ip_address: { type: DataTypes.STRING, allowNull: true },
    device_fingerprint: { type: DataTypes.STRING, allowNull: true },

    // AI Fields (We will use these later!)
    risk_score: { type: DataTypes.INTEGER, defaultValue: 0 },
    action_taken: { type: DataTypes.STRING, defaultValue: 'ALLOW' } // ALLOW, FLAG, BLOCK
});

module.exports = ActivityLog;