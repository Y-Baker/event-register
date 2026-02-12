const express = require('express');
const router = express.Router({ mergeParams: true }); 

const qrController = require('../controllers/qrController');
const { requireRole, requireEventScope } = require('../../middlewares/auth');

router.post('/send', requireRole('organizer', 'admin'), requireEventScope(), qrController.sendQRToParticipants);
router.post('/scan', requireRole('scanner', 'admin'), requireEventScope(), qrController.registerActivity);

module.exports = router;
