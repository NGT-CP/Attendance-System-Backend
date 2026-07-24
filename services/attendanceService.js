// Replace your existing markStudentAttendance with this:
export const markStudentAttendance = (classId, code, lat, lng, accuracy, timestamp, deviceHash) =>
    API.post(`/classes/${classId}/attendance/mark`, {
        code,
        lat,
        lng,
        accuracy,
        timestamp,
        device_hash: deviceHash
    });