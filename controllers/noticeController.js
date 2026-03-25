const { Notice, ChatMessage, User, Classroom, Enrollment } = require('../models');

exports.createNotice = async (req, res) => {
    try {
        const classId = req.params.id;
        const authorId = req.user.id;
        const { title, content, file_url, allows_chat } = req.body;

        const classroom = await Classroom.findByPk(classId);
        if (classroom.owner_id !== authorId) {
            return res.status(403).json({ success: false, message: "Only teachers can post notices." });
        }

        let file_name = null;

        

        const newNotice = await Notice.create({
            class_id: classId,
            author_id: authorId,
            title,
            content,
            attachment_url: file_url || null,
            file_name: file_name,
            allows_chat: allows_chat
        });

        const noticeWithDetails = await Notice.findByPk(newNotice.id, {
            include: [
                { model: User, as: 'Author', attributes: ['firstName', 'lastName'] },
                { model: ChatMessage }
            ]
        });

        res.status(201).json({ success: true, notice: noticeWithDetails });
    } catch (error) {
        console.error("Create Notice Error:", error);
        res.status(500).json({ success: false, message: "Failed to create notice" });
    }
};

exports.addChat = async (req, res) => {
    try {
        const { message } = req.body;
        const noticeId = req.params.noticeId;
        const senderId = req.user.id;

        if (!message) return res.status(400).json({ message: "Message cannot be empty" });

        const notice = await Notice.findByPk(noticeId);
        if (!notice || !notice.allows_chat) {
            return res.status(403).json({ success: false, message: "The teacher has disabled comments for this notice." });
        }

        const newChat = await ChatMessage.create({ message, notice_id: noticeId, sender_id: senderId });
        const chatWithUser = await ChatMessage.findByPk(newChat.id, {
            include: [{ model: User, as: 'Sender', attributes: ['firstName', 'lastName'] }]
        });

        res.status(201).json({ success: true, chat: chatWithUser });
    } catch (error) {
        console.error("Chat Error:", error);
        res.status(500).json({ success: false, message: "Failed to send message" });
    }
};

exports.getMyNotices = async (req, res) => {
    try {
        const userId = req.user.id;

        const enrollments = await Enrollment.findAll({ where: { user_id: userId } });
        const classIds = enrollments.map(e => e.class_id);

        if (classIds.length === 0) return res.json({ success: true, notices: [] });

        const notices = await Notice.findAll({
            where: { class_id: classIds },
            include: [
                { model: User, as: 'Author', attributes: ['firstName', 'lastName'] },
                { model: ChatMessage }
            ],
            order: [['createdAt', 'DESC']]
        });

        const filteredNotices = notices.filter(notice => {
            if (notice.author_id !== userId) return true;
            const hasStudentReply = notice.ChatMessages && notice.ChatMessages.some(msg => msg.sender_id !== userId);
            return hasStudentReply;
        });

        res.json({ success: true, notices: filteredNotices });
    } catch (error) {
        console.error("Dashboard Notices Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch dashboard notices" });
    }
};