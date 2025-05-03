const express = require('express');
const router = express.Router();

const eventController = require('../controllers/eventController');
const activityRoutes = require('./activityRoutes');
const participantRoutes = require('./participantRoutes');
const qrRoutes = require('./qrRoutes');

const { validateCreateEvent } = require('../validators/eventValidator');
const validateRequest = require('../../middlewares/validateRequest');

router.use('/:eventId/activities', activityRoutes);
router.use('/:eventId/participants', participantRoutes);
router.use('/:eventId/qr', qrRoutes);

router.post('/', validateCreateEvent, validateRequest, eventController.createEvent);
router.get('/', eventController.getAllEvents);
router.get('/:eventId', eventController.getEventById);
router.delete('/:eventId', eventController.deleteEvent);


module.exports = router;
