const supabase = require('../config/supabase');

const requireTeacher = async (req, res, next) => {
    try {
        const classId = req.params.id;
        const userId = req.user.id;

        const { data: classroom, error } = await supabase
            .from('classrooms')
            .select('*')
            .eq('id', classId)
            .maybeSingle();

        if (error || !classroom) {
            return res.status(404).json({ success: false, message: "Class not found." });
        }

        if (classroom.owner_id !== userId) {
            return res.status(403).json({ success: false, message: "Teacher access required." });
        }

        // Attach classroom to request so downstream controllers don't have to fetch it again
        req.classroom = classroom;
        next();
    } catch (err) {
        console.error("Role Auth Error:", err);
        res.status(500).json({ success: false, message: "Server error in role validation." });
    }
};

module.exports = requireTeacher;