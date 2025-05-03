const express = require('express');
const { requireRole } = require('../../middlewares/auth');
const adminController = require('../controllers/adminController');
const router = express.Router();

router.get('/keys', requireRole('admin'), adminController.getAllkeys);
router.get('/keys/:KeyName', requireRole('admin'), adminController.getKeyByName);
router.post('/keys/:KeyName/issue', requireRole('admin'), adminController.issueNewKey);

module.exports = router;