const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Enrollment = sequelize.define("Enrollment", {

    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },

    user_id: {
        type: DataTypes.UUID,
        allowNull: false
    },

    class_id: {
        type: DataTypes.UUID,
        allowNull: false
    }

});

module.exports = Enrollment;