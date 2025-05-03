const express = require('express');
const router = express.Router({ mergeParams: true });

const activityController = require('../controllers/activityController');
const { validateCreateActivity } = require('../validators/activityValidator');
const validateRequest = require('../../middlewares/validateRequest');

router.post('/', validateCreateActivity, validateRequest, activityController.createActivity);
router.get('/', activityController.getEventActivities);
router.get('/:activityId', activityController.getActivityById);

module.exports = router;
