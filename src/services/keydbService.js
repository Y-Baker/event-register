const redis = require('redis');
// Use console as logger to avoid cross-repo dependency
const logger = {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args)
};

let redisClient;

const ensureConnected = () => {
  if (!redisClient || !redisClient.isOpen) {
    throw new Error('Redis client is not connected');
  }
};

const openConnection = async () => {
  const config = require('../config');

  // Support REDIS_URL env in addition to host/port/password
  const url = process.env.REDIS_URL || null;
  if (url) {
    redisClient = redis.createClient({
      url,
      password: config.redis.password || process.env.REDIS_PASSWORD || undefined,
    });
  } else {
    redisClient = redis.createClient({
      socket: {
        host: config.redis.host,
        port: config.redis.port,
      },
      password: config.redis.password,
    });
  }

  try {
    await redisClient.connect();
    console.log('✅ Redis connected');
  } catch (err) {
    console.error('❌ Redis connection failed:', err);
    throw new Error('Redis connection failed');
  }
};

const checkHealth = async () => {
  try {
    ensureConnected();
    const ping = await redisClient.ping();
    return { healthy: true, ping };
  } catch (error) {
    console.error('❌ Redis health check failed:', error);
    return { healthy: false, error: error.message };
  }
};

const setKey = async (key, value, expirationInSeconds) => {
  try {
    ensureConnected();
    const options = {};
    if (typeof expirationInSeconds === 'number' && Number.isFinite(expirationInSeconds) && expirationInSeconds > 0) {
      options.EX = expirationInSeconds;
    }

    if (Object.keys(options).length) {
      await redisClient.set(key, JSON.stringify(value), options);
    } else {
      await redisClient.set(key, JSON.stringify(value));
    }
  } catch (error) {
    console.error(`❌ Failed to set key ${key}:`, error);
    throw new Error('Failed to set key');
  }
};

const bootstrapDefaultRoleKeys = async () => {
  const config = require('../config');
  try {
    ensureConnected();

    const organizerKeyName = config.apiKeys?.organizerId;
    const scannerKeyName = config.apiKeys?.scannerId;

    if (!organizerKeyName || !scannerKeyName) {
      logger.info('ℹ️ Legacy role keys (ORGANIZER_ID / SCANNER_ID) not provided; skipping bootstrap (auth handled via JWT claims)');
      return null;
    }

    const organizerExisting = await getKey(organizerKeyName);
    if (!organizerExisting) {
      await setKey(organizerKeyName, organizerKeyName);
      logger.info(`✅ Bootstrapped organizer key in Redis: ${organizerKeyName}`);
    }

    const scannerExisting = await getKey(scannerKeyName);
    if (!scannerExisting) {
      await setKey(scannerKeyName, scannerKeyName);
      logger.info(`✅ Bootstrapped scanner key in Redis: ${scannerKeyName}`);
    }

    return {
      organizer: organizerExisting || organizerKeyName,
      scanner: scannerExisting || scannerKeyName,
    };
  } catch (error) {
    logger.error('❌ Failed to bootstrap default role keys:', error);
    throw new Error('Failed to bootstrap default role keys');
  }
};

const getKey = async (key) => {
  try {
    ensureConnected();
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error(`❌ Failed to get key ${key}:`, error);
    throw new Error('Failed to get key');
  }
};

const deleteKey = async (key) => {
  try {
    ensureConnected();
    await redisClient.del(key);
  } catch (error) {
    console.error(`❌ Failed to delete key ${key}:`, error);
    throw new Error('Failed to delete key');
  }
};

const keyExists = async (key) => {
  try {
    ensureConnected();
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (error) {
    console.error(`❌ Failed to check key existence: ${key}`, error);
    throw new Error('Failed to check key existence');
  }
};

const flushAllKeys = async () => {
  try {
    ensureConnected();
    await redisClient.flushAll();
  } catch (error) {
    console.error('❌ Failed to flush keys:', error);
    throw new Error('Failed to flush keys');
  }
};

// Publish a message to a Redis Stream (XADD)
const publishToStream = async (stream, payloadObject) => {
  try {
    ensureConnected();
    const payload = JSON.stringify(payloadObject);
    // Use raw command for compatibility
    logger.info(`Publishing to stream ${stream}: ${payloadObject.id}`);
    await redisClient.sendCommand(['XADD', stream, '*', 'payload', payload]);
  } catch (error) {
    console.error(`❌ Failed to publish to stream ${stream}:`, error);
    throw new Error('Failed to publish to stream');
  }
};

const closeConnection = async () => {
  try {
    await redisClient.quit();
    console.log('✅ Redis connection closed');
  } catch (error) {
    console.error('❌ Failed to close Redis connection:', error);
  }
};

module.exports = {
  openConnection,
  closeConnection,
  setKey,
  getKey,
  deleteKey,
  keyExists,
  flushAllKeys,
  checkHealth,
  publishToStream,
  bootstrapDefaultRoleKeys,
};
