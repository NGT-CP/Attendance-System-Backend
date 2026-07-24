// backend/services/deviceService.js
const supabase = require('../config/supabase');

/**
 * Evaluates device fingerprints based on SentryX Anti-Proxy rules.
 * Does NOT block attendance. Only calculates risk & trust metrics.
 */
exports.evaluateDevice = async (studentId, deviceHash) => {
    // Graceful fallback for backward compatibility 
    if (!deviceHash || deviceHash === 'UNKNOWN_DEVICE') {
        return { trustPenalty: 0, flagged: false, reason: 'Legacy or missing device hash' };
    }

    try {
        // Fetch all historical usage of this specific device hash
        const { data: devices, error } = await supabase
            .from('attendance_devices')
            .select('*')
            .eq('device_hash', deviceHash);

        if (error) throw error;

        const isKnownToStudent = devices?.find(d => d.student_id === studentId);
        const usedByOtherStudents = devices?.filter(d => d.student_id !== studentId);

        let trustPenalty = 0;
        let flagged = false;
        let reason = 'Valid known device';

        // Rule 3: One fingerprint used by multiple accounts
        if (usedByOtherStudents && usedByOtherStudents.length > 0) {
            flagged = true;
            trustPenalty = 25;
            reason = 'Device fingerprint shared across multiple accounts';

            if (!isKnownToStudent) {
                await this.registerDevice(studentId, deviceHash, 100 - trustPenalty);
            } else {
                await this.updateLastSeen(isKnownToStudent.id);
            }
        }
        // Rule 1: Known device
        else if (isKnownToStudent) {
            trustPenalty = 0;
            reason = 'Known trusted device';
            await this.updateLastSeen(isKnownToStudent.id);
        }
        // Rule 2: New device (First time seeing this hash for this student)
        else {
            trustPenalty = 5;
            reason = 'New device registered';
            await this.registerDevice(studentId, deviceHash, 100 - trustPenalty);
        }

        return { trustPenalty, flagged, reason };

    } catch (err) {
        console.error("Device evaluation error:", err);
        // Fail-open: Never block core attendance functionality if AI evaluation fails
        return { trustPenalty: 0, flagged: false, reason: 'Error evaluating device' };
    }
};

exports.registerDevice = async (studentId, deviceHash, initialTrust) => {
    await supabase.from('attendance_devices').insert([{
        student_id: studentId,
        device_hash: deviceHash,
        trust_score: initialTrust,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString()
    }]);
};

exports.updateLastSeen = async (recordId) => {
    await supabase.from('attendance_devices')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', recordId);
};