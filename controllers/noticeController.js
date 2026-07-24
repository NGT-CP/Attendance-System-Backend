const supabase = require('../config/supabase');

const mapUserToCamelCase = (user) => {
    if (!user) return null;
    return { firstName: user.first_name, lastName: user.last_name, ...user };
};

// ==========================================
// GET ALL MY NOTICES (Dashboard Tab)
// ==========================================
exports.getMyNotices = async (req, res) => {
    try {
        const userId = req.user.id;

        // Get classes user owns or is enrolled in
        const { data: enrolledClasses } = await supabase.from('enrollments').select('class_id').eq('user_id', userId);
        const { data: ownedClasses } = await supabase.from('classrooms').select('id').eq('owner_id', userId);

        const classIds = [
            ...(enrolledClasses || []).map(e => e.class_id),
            ...(ownedClasses || []).map(c => c.id)
        ];

        if (classIds.length === 0) return res.json({ success: true, notices: [] });

        const { data: notices, error } = await supabase
            .from('notices')
            .select(`*, Author:users!fk_notices_author(first_name, last_name)`)
            .in('class_id', classIds)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const formattedNotices = notices.map(n => ({ ...n, Author: mapUserToCamelCase(n.Author) }));
        res.json({ success: true, notices: formattedNotices });
    } catch (error) {
        console.error("Get Notices Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to fetch notices" });
    }
};

// ==========================================
// CREATE NOTICE
// ==========================================
exports.createNotice = async (req, res) => {
    try {
        const classId = req.params.id;
        const { title, content, file_url, allows_chat } = req.body;
        const authorId = req.user.id;

        const { data: classroom } = await supabase.from('classrooms').select('owner_id').eq('id', classId).maybeSingle();
        if (!classroom || classroom.owner_id !== authorId) return res.status(403).json({ success: false, message: "Unauthorized" });

        const { data: notice, error } = await supabase
            .from('notices')
            .insert([{ class_id: classId, author_id: authorId, title, content, attachment_url: file_url, allow_chat: allows_chat }])
            .select(`*, Author:users!fk_notices_author(first_name, last_name)`)
            .single();

        if (error) throw error;

        notice.Author = mapUserToCamelCase(notice.Author);
        res.status(201).json({ success: true, notice });
    } catch (error) {
        console.error("Create Notice Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to create notice" });
    }
};

// ==========================================
// INLINE CHAT OPERATIONS
// ==========================================
exports.addChat = async (req, res) => {
    try {
        const { noticeId } = req.params;
        const { message } = req.body;
        const senderId = req.user.id;

        const { data: notice } = await supabase.from('notices').select('allow_chat, class_id').eq('id', noticeId).maybeSingle();
        if (!notice) return res.status(404).json({ success: false, message: "Notice not found" });
        if (!notice.allow_chat) return res.status(403).json({ success: false, message: "Replies disabled by teacher." });

        const { data: chat, error } = await supabase
            .from('chat_messages')
            .insert([{ notice_id: noticeId, sender_id: senderId, message }])
            .select(`*, Sender:users!fk_chat_sender(first_name, last_name)`)
            .single();

        if (error) throw error;

        chat.Sender = mapUserToCamelCase(chat.Sender);
        res.status(201).json({ success: true, chat });
    } catch (error) {
        console.error("Add Chat Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to send message" });
    }
};

exports.updateChat = async (req, res) => {
    try {
        const { chatId } = req.params;
        const { message } = req.body;
        const senderId = req.user.id;

        const { data: chat } = await supabase.from('chat_messages').select('*').eq('id', chatId).maybeSingle();
        if (!chat) return res.status(404).json({ success: false, message: "Message not found" });
        if (chat.sender_id !== senderId) return res.status(403).json({ success: false, message: "Unauthorized" });

        // 15-minute edit limit
        const diffMinutes = (new Date() - new Date(chat.created_at)) / 1000 / 60;
        if (diffMinutes > 15) return res.status(403).json({ success: false, message: "Edit time expired (15 mins max)." });

        const { error } = await supabase.from('chat_messages').update({ message }).eq('id', chatId);
        if (error) throw error;

        res.json({ success: true, message: "Message updated" });
    } catch (error) {
        console.error("Update Chat Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to update message" });
    }
};

exports.deleteChat = async (req, res) => {
    try {
        const { error } = await supabase.from('chat_messages').delete().eq('id', req.params.chatId).eq('sender_id', req.user.id);
        if (error) throw error;
        res.json({ success: true, message: "Message deleted" });
    } catch (error) {
        console.error("Delete Chat Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to delete message" });
    }
};

// ==========================================
// TEACHER MODERATION CONTROLS
// ==========================================
exports.updateNotice = async (req, res) => {
    try {
        const { noticeId } = req.params;
        const { title, content, file_url, allows_chat } = req.body;

        const { error } = await supabase
            .from('notices')
            .update({ title, content, attachment_url: file_url, allow_chat: allows_chat })
            .eq('id', noticeId)
            .eq('author_id', req.user.id); // Validates ownership implicitly

        if (error) throw error;
        res.json({ success: true, message: "Notice updated" });
    } catch (error) {
        console.error("Update Notice Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to update notice" });
    }
};

exports.deleteNotice = async (req, res) => {
    try {
        // Cascade delete will automatically remove all associated chat_messages
        const { error } = await supabase.from('notices').delete().eq('id', req.params.noticeId).eq('author_id', req.user.id);
        if (error) throw error;
        res.json({ success: true, message: "Notice deleted" });
    } catch (error) {
        console.error("Delete Notice Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to delete notice" });
    }
};

exports.setChatEnabled = async (req, res) => {
    try {
        const { noticeId } = req.params;
        const { allows_chat } = req.body;

        const { error } = await supabase.from('notices').update({ allow_chat: allows_chat }).eq('id', noticeId).eq('author_id', req.user.id);
        if (error) throw error;
        res.json({ success: true, message: `Chat ${allows_chat ? 'enabled' : 'disabled'}` });
    } catch (error) {
        console.error("Toggle Chat Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to update chat settings" });
    }
};