const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Notice = sequelize.define("Notice", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    class_id: { type: DataTypes.UUID, allowNull: false },
    author_id: { type: DataTypes.UUID, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    attachment_url: { type: DataTypes.STRING, allowNull: true },
    file_name: { type: DataTypes.STRING, allowNull: true },     // NEW: Stores the Drive file name
    allows_chat: { type: DataTypes.BOOLEAN, defaultValue: true } // NEW: Teacher control toggle
});

module.exports = Notice;