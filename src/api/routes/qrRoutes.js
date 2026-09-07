const express = require('express');
const router = express.Router({ mergeParams: true }); 

const qrController = require('../controllers/qrController');
const { requireRole, requireEventScope } = require('../../middlewares/auth');

router.post('/send', requireRole('organizer', 'admin'), requireEventScope(), qrController.sendQRToParticipants);
router.post('/prepare-campaign', requireRole('organizer', 'admin'), requireEventScope(), qrController.prepareEventQRCampaign);
router.post('/dispatch-callback', qrController.dispatchCallback);
router.post('/scan', requireRole('scanner', 'admin'), requireEventScope(), qrController.registerActivity);

module.exports = router;
