export const generateDeviceFingerprint = async () => {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = "top"; ctx.font = "14px Arial";
        ctx.fillText("SentryX", 2, 15);
        const canvasData = canvas.toDataURL();

        let webglRenderer = "unknown";
        try {
            const gl = document.createElement('canvas').getContext('webgl');
            if (gl) {
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                if (debugInfo) webglRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            }
        } catch (e) { }

        const screenRes = `${window.screen.width}x${window.screen.height}`;
        const platform = navigator.platform || "unknown";
        const browser = navigator.userAgent;
        const cores = navigator.hardwareConcurrency || "unknown";
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";

        const rawString = `${canvasData}|${webglRenderer}|${screenRes}|${platform}|${browser}|${cores}|${tz}`;

        const encoder = new TextEncoder();
        const data = encoder.encode(rawString);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        return "UNKNOWN_DEVICE";
    }
};