const express = require('express');
const router = express.Router();

const baseController = require('../controllers/baseController');

router.get('/', baseController.getAllRoutes);
router.get('/health', baseController.healthCheck);
router.get('/health/db', baseController.MongoDBHealthCheck);

module.exports = router;