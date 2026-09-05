const express = require('express');
const router = express.Router();

const baseController = require('../controllers/baseController');
const activityController = require('../controllers/activityController');
const qrController = require('../controllers/qrController');
const { requireRole } = require('../../middlewares/auth');

router.get('/', requireRole('admin'), baseController.getAllRoutes);
router.get('/health', baseController.healthCheck);
router.get('/health/db', baseController.MongoDBHealthCheck);
router.get('/health/redis', baseController.RedisHealthCheck);

// Public / Attendee Self-Service Check-In Endpoints
router.get('/activities/qr/:qrId', activityController.getActivityByQrId);
router.post('/activities/qr/:qrId/self-checkin', qrController.selfCheckIn);

module.exports = router;