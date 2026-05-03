require('dotenv').config();

function parseEnvInteger(value, fallback) {
	if (value === undefined || value === null || String(value).trim() === '') {
		return fallback;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}

	return Math.trunc(parsed);
}

const config = {
	env: process.env.NODE_ENV || 'development',
	port: parseInt(process.env.PORT || '5000', 10),
	baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`,
	mongo: {
		uri: process.env.MONGO_URI
	},
	redis: {
		host: process.env.REDIS_HOST,
		port: parseInt(process.env.REDIS_PORT || '6379', 10),
		password: process.env.REDIS_PASSWORD || undefined
	},
	email: {
		stream: process.env.REDIS_STREAM_EMAIL || null,
		serviceUrl: process.env.EMAIL_SERVICE_URL || null,
		serviceAuthToken: process.env.EMAIL_SERVICE_AUTH_TOKEN || null
	},
	auth: {
		claimsHmacSecret: process.env.AUTH_CLAIMS_HMAC_SECRET || '',
		maxClaimsLifetimeSeconds: parseEnvInteger(process.env.MAX_CLAIMS_LIFETIME_SECONDS, 15 * 60),
		claimsClockSkewSeconds: parseEnvInteger(process.env.CLAIMS_CLOCK_SKEW_SECONDS, 30)
	},
	apiKeys: {
		organizerId: process.env.ORGANIZER_ID,
		scannerId: process.env.SCANNER_ID
	}
};

module.exports = config;
