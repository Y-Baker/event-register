const express = require('express');
const router = express.Router({ mergeParams: true }); 

const qrController = require('../controllers/qrController');
const { requireRole } = require('../../middlewares/auth');

router.get('/send', requireRole('admin'), qrController.sendQRToParticipants);
router.post('/register-activity', requireRole('scanner', 'admin'), qrController.registerActivity);

module.exports = router;