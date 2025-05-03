const mongoose = require('mongoose');
const { checkHealth } = require('../../services/keydbService');

const getAllRoutes = (req, res) => {
  res.status(200).json({
    message: 'Welcome to the API',
    routes: [
      { method: 'GET', path: '/api/v1/', description: 'Welcome to the API' },
      { method: 'GET', path: '/api/v1/health', description: 'Health check for the API' },
      { method: 'GET', path: '/api/v1/health/db', description: 'Health check for the MongoDB connection' },
      { method: 'GET', path: '/api/v1/health/redis', description: 'Health check for the Redis connection'},

      { method: 'POST', path: '/api/v1/events', description: 'Create a new event' },
      { method: 'GET', path: '/api/v1/events', description: 'Get all events' },
      { method: 'GET', path: '/api/v1/events/:id', description: 'Get event by ID' },
      { method: 'DELETE', path: '/api/v1/events/:id', description: 'Delete event by ID' },

      { method: 'GET', path: '/api/v1/events/:id/activities/', description: 'Get all activities for an event' },
      { method: 'POST', path: '/api/v1/events/:id/activities/', description: 'Create a new activity for an event' },
      { method: 'GET', path: '/api/v1/events/:id/activities/:activityId', description: 'Get activity by ID' },
      
      { method: 'POST', path: '/api/v1/events/:id/participants/', description: 'Add participants to an event' },
      { method: 'GET', path: '/api/v1/events/:id/participants/', description: 'Get all participants for an event' },
      { method: 'GET', path: '/api/v1/events/:id/participants/:participantId', description: 'Get participant by ID' },
      { method: 'POST', path: '/api/v1/enents/participants/upload/', description: 'Upload participants from a CSV file' },

      { method: 'GET', path: '/api/v1/events/:id/qr/send', description: 'Send QR codes to participants via email' },
      { method: 'POST', path: '/api/v1/events/:id/qr/register-activity', description: 'Register a scanned activity for a participant' },

      { method: 'POST', path: '/api/v1/admin/keys/:KeyName/issue', description: 'Issue a new key' },
      { method: 'GET', path: '/api/v1/admin/keys', description: 'Get all keys' },
      { method: 'GET', path: '/api/v1/admin/keys/:KeyName', description: 'Get key by name' },
    ],
  });
}

const healthCheck = (req, res) => {
  res.status(200).json({
    message: 'API is running',
    timestamp: new Date(),
  });
}

const MongoDBHealthCheck = async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.status(200).json({
      message: 'MongoDB is healthy',
      timestamp: new Date(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: 'MongoDB is not healthy',
      error: err.message,
      timestamp: new Date(),
    });
  }
}

const RedisHealthCheck = async (req, res) => {
  const status = await checkHealth();

  if (status.healthy) {
    return res.status(200).json({
      message: `Redis is healthy. Ping response: ${status.ping}`,
      timestamp: new Date(),
    });
  }

  return res.status(500).json({
    message: 'Redis is not healthy.',
    error: status.error,
    timestamp: new Date(),
  });
};


module.exports = {
  getAllRoutes,
  healthCheck,
  MongoDBHealthCheck,
  RedisHealthCheck
};
