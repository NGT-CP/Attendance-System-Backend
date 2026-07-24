// backend/services/gpsIntelligenceService.js

/**
 * Validates the integrity of a GPS signal based on coordinate limits, 
 * hardware accuracy, and timestamp chronology.
 * 
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} accuracy - GPS accuracy in meters (from HTML5 Geolocation API)
 * @param {number|string} clientTimestamp - Timestamp of when the GPS fix was acquired
 * @param {Object} config - Configurable thresholds
 * @returns {Object} { isValid: boolean, reason: string }
 */
exports.validateGpsSignal = (lat, lng, accuracy, clientTimestamp, config = {}) => {
    // 1. Configurable Thresholds
    const MAX_ACCURACY_METERS = config.maxAccuracy || 60; // Reject if accuracy radius is > 60m
    const MAX_AGE_MS = config.maxAgeMs || 2 * 60 * 1000;  // Reject if signal is older than 2 mins
    const ALLOWED_FUTURE_DRIFT_MS = 15 * 1000;            // Allow 15s for client clock running fast

    // 2. Coordinate Validation
    if (lat === undefined || lng === undefined || lat === null || lng === null) {
        return { isValid: false, reason: 'Missing GPS coordinates' };
    }
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    if (isNaN(parsedLat) || isNaN(parsedLng)) {
        return { isValid: false, reason: 'Invalid coordinate format' };
    }
    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
        return { isValid: false, reason: 'Impossible GPS coordinates (out of bounds)' };
    }

    // 3. Accuracy Validation
    if (accuracy === undefined || accuracy === null || isNaN(parseFloat(accuracy))) {
        return { isValid: false, reason: 'Missing GPS accuracy metric' };
    }
    if (parseFloat(accuracy) > MAX_ACCURACY_METERS) {
        return {
            isValid: false,
            reason: `GPS accuracy (${accuracy}m) is too poor. Must be under ${MAX_ACCURACY_METERS}m.`
        };
    }

    // 4. Timestamp Validation (Chronology & Replay Protection)
    if (!clientTimestamp) {
        return { isValid: false, reason: 'Missing GPS timestamp' };
    }

    const signalTime = new Date(clientTimestamp).getTime();
    if (isNaN(signalTime)) {
        return { isValid: false, reason: 'Invalid timestamp format' };
    }

    const serverNow = Date.now();
    const timeDifference = serverNow - signalTime; // Positive = past, Negative = future

    if (timeDifference < -ALLOWED_FUTURE_DRIFT_MS) {
        return { isValid: false, reason: 'Impossible timestamp (signal is from the future)' };
    }
    if (timeDifference > MAX_AGE_MS) {
        return { isValid: false, reason: 'Stale GPS signal (possible replay attack)' };
    }

    // 5. Signal is Clean
    return { isValid: true, reason: 'GPS signal verified' };
};