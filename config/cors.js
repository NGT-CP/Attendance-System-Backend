const env = require('./env');

const corsOptions = {
    origin: env.frontendUrl,
    credentials: true,

    methods: [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS'
    ],

    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Device-Fingerprint'
    ]
};

module.exports = corsOptions;