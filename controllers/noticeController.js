const { Notice, ChatMessage, User, Classroom, Enrollment } = require('../models');

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const isWithinFifteenMinutes = (createdAt) => {
    if (!createdAt) return false;
    const createdTime = new Date(createdAt).getTime();
    if (Number.isNaN(createdTime)) return false;
    return (Date.now() - createdTime) <= FIFTEEN_MINUTES_MS;
};

exports.createNotice = async (req, res) => {
    try {
        const classId = req.params.id;
        const authorId = req.user.id;
        const { title, content, file_url, allows_chat } = req.body;

        if (!title || !content) {
            return res.status(400).json({ success: false, message: "title and content are required" });
        }


        // 🛡️ SECURITY: Strict URL parsing to prevent phishing/XSS payloads
        if (file_url) {
            try {
                const parsedUrl = new URL(file_url);
                if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                    return res.status(400).json({ success: false, message: "Invalid link. Must be http or https." });
                }
            } catch (err) {
                return res.status(400).json({ success: false, message: "Invalid URL format." });
            }
        }

        const classroom = await Classroom.findByPk(classId);
        if (!classroom) {
            return res.status(404).json({ success: false, message: "Class not found" });
        }

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

exports.setChatEnabled = async (req, res) => {
    try {
        const noticeId = req.params.noticeId;
        const { allows_chat, allowsChat } = req.body;
        const newAllowsChat = typeof allows_chat !== 'undefined' ? allows_chat : allowsChat;

        if (typeof newAllowsChat !== 'boolean') {
            return res.status(400).json({ success: false, message: "allows_chat must be a boolean" });
        }

        const notice = await Notice.findByPk(noticeId);
        if (!notice) return res.status(404).json({ success: false, message: "Notice not found" });

        const classroom = await Classroom.findByPk(notice.class_id);
        if (!classroom) return res.status(404).json({ success: false, message: "Class not found" });
        if (classroom.owner_id !== req.user.id) {
            return res.status(403).json({ success: false, message: "Admin only Access" });
        }

        notice.allows_chat = newAllowsChat;
        await notice.save();

        res.json({ success: true, notice });
    } catch (error) {
        console.error("Set Chat Enabled Error:", error);
        res.status(500).json({ success: false, message: "Failed to update notice chat settings" });
    }
};

exports.updateNotice = async (req, res) => {
    try {
        const noticeId = req.params.noticeId;
        const { title, content, file_url, allows_chat, allowsChat } = req.body;

        const notice = await Notice.findByPk(noticeId);
        if (!notice) return res.status(404).json({ success: false, message: "Notice not found" });

        const classroom = await Classroom.findByPk(notice.class_id);
        if (!classroom) return res.status(404).json({ success: false, message: "Class not found" });
        if (classroom.owner_id !== req.user.id) {
            return res.status(403).json({ success: false, message: "Admin only Access" });
        }

        // Only update fields if they're provided.
        if (typeof title !== 'undefined') notice.title = title;
        if (typeof content !== 'undefined') notice.content = content;
        if (typeof file_url !== 'undefined') notice.attachment_url = file_url || null;

        const newAllowsChat = typeof allows_chat !== 'undefined' ? allows_chat : allowsChat;
        if (typeof newAllowsChat !== 'undefined') notice.allows_chat = newAllowsChat;

        await notice.save();
        res.json({ success: true, notice });
    } catch (error) {
        console.error("Update Notice Error:", error);
        res.status(500).json({ success: false, message: "Failed to update notice" });
    }
};

exports.deleteNotice = async (req, res) => {
    try {
        const noticeId = req.params.noticeId;

        const notice = await Notice.findByPk(noticeId);
        if (!notice) return res.status(404).json({ success: false, message: "Notice not found" });

        const classroom = await Classroom.findByPk(notice.class_id);
        if (!classroom) return res.status(404).json({ success: false, message: "Class not found" });
        if (classroom.owner_id !== req.user.id) {
            return res.status(403).json({ success: false, message: "Admin only Access" });
        }

        // Delete related chat messages first to avoid orphaned rows.
        await ChatMessage.destroy({ where: { notice_id: noticeId } });
        await notice.destroy();

        res.json({ success: true });
    } catch (error) {
        console.error("Delete Notice Error:", error);
        res.status(500).json({ success: false, message: "Failed to delete notice" });
    }
};

exports.updateChat = async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const { message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, message: "Message cannot be empty" });
        }

        const chat = await ChatMessage.findByPk(chatId, {
            include: [{ model: Notice }]
        });
        if (!chat) return res.status(404).json({ success: false, message: "Chat not found" });

        if (chat.sender_id !== req.user.id) {
            return res.status(403).json({ success: false, message: "Not allowed" });
        }

        if (!isWithinFifteenMinutes(chat.createdAt)) {
            return res.status(403).json({ success: false, message: "Chat edit window (15 minutes) has expired." });
        }

        chat.message = message;
        await chat.save();

        const updatedChatWithUser = await ChatMessage.findByPk(chatId, {
            include: [{ model: User, as: 'Sender', attributes: ['firstName', 'lastName'] }]
        });

        res.json({ success: true, chat: updatedChatWithUser });
    } catch (error) {
        console.error("Update Chat Error:", error);
        res.status(500).json({ success: false, message: "Failed to update chat" });
    }
};

exports.deleteChat = async (req, res) => {
    try {
        const chatId = req.params.chatId;

        const chat = await ChatMessage.findByPk(chatId, {
            include: [{ model: Notice }]
        });
        if (!chat) return res.status(404).json({ success: false, message: "Chat not found" });

        const classroom = chat.Notice ? await Classroom.findByPk(chat.Notice.class_id) : null;
        const isSender = chat.sender_id === req.user.id;
        const isTeacher = classroom && classroom.owner_id === req.user.id;

        if (!isSender && !isTeacher) {
            return res.status(403).json({ success: false, message: "Not allowed" });
        }

        // 15-minute deletion restriction has been removed here. 
        // Send/Teacher can now delete at any time.

        await chat.destroy();
        res.json({ success: true });
    } catch (error) {
        console.error("Delete Chat Error:", error);
        res.status(500).json({ success: false, message: "Failed to delete chat" });
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