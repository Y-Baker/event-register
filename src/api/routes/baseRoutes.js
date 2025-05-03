const express = require('express');
const router = express.Router();

const baseController = require('../controllers/baseController');
const { requireRole } = require('../../middlewares/auth');

router.get('/', requireRole('admin'), baseController.getAllRoutes);
router.get('/health', baseController.healthCheck);
router.get('/health/db', baseController.MongoDBHealthCheck);
router.get('/health/redis', baseController.RedisHealthCheck);

module.exports = router;