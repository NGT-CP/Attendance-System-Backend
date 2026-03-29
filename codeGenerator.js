const crypto = require('crypto');
const { Classroom } = require('./models');

exports.generateUniqueCode = async () => {
    let isUnique = false;
    let code = '';

    while (!isUnique) {
        // 🛡️ SECURITY: Cryptographically secure random bytes
        code = crypto.randomBytes(3).toString('hex').toUpperCase();
        const existing = await Classroom.findOne({ where: { join_code: code } });
        if (!existing) isUnique = true;
    }

    return code;
};