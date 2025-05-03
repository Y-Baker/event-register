const express = require('express');
const router = express.Router({ mergeParams: true }); 

const qrController = require('../controllers/qrController');

router.get('/send', qrController.sendQRToParticipants);
router.post('/register-activity', qrController.registerActivity);

module.exports = router;