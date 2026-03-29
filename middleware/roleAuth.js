const { Classroom } = require('../models');

const requireTeacher = async (req, res, next) => {
    try {
        const classId = req.params.id;
        const classroom = await Classroom.findByPk(classId);

        if (!classroom) return res.status(404).json({ success: false, message: "Class not found" });
        if (classroom.owner_id !== req.user.id) {
            return res.status(403).json({ success: false, message: "Access Denied: Teachers only." });
        }

        req.classroom = classroom; // Pass it along so the controller doesn't have to fetch it again!
        next();
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error verifying role" });
    }
};

module.exports = requireTeacher;