const express = require('express');
const router = express.Router({ mergeParams: true });

const activityController = require('../controllers/activityController');
const { validateCreateActivity } = require('../validators/activityValidator');
const validateRequest = require('../../middlewares/validateRequest');
const { requireRole, requireEventScope } = require('../../middlewares/auth');

router.post('/', requireRole('organizer', 'admin'), requireEventScope(), validateCreateActivity, validateRequest, activityController.createActivity);
router.get('/', requireRole('organizer', 'scanner', 'admin'), requireEventScope(), activityController.getEventActivities);
router.get('/:activityId', requireRole('organizer', 'scanner', 'admin'), requireEventScope(), activityController.getActivityById);
router.patch('/:activityId', requireRole('organizer', 'admin'), requireEventScope(), activityController.updateActivity);
router.patch('/:activityId/whitelist', requireRole('organizer', 'admin'), requireEventScope(), activityController.updateActivityWhitelist);
router.patch('/:activityId/lock', requireRole('organizer', 'admin'), requireEventScope(), activityController.toggleActivityLock);
router.patch('/:activityId/mode', requireRole('organizer', 'admin'), requireEventScope(), activityController.setActivityMode);
router.delete('/:activityId', requireRole('organizer', 'admin'), requireEventScope(), activityController.deleteActivity);

module.exports = router;
