const express = require('express');
const router = express.Router();

const eventController = require('../controllers/eventController');
const attendanceController = require('../controllers/attendanceController');
const activityRoutes = require('./activityRoutes');
const participantRoutes = require('./participantRoutes');
const qrRoutes = require('./qrRoutes');

const { validateCreateEvent } = require('../validators/eventValidator');
const validateRequest = require('../../middlewares/validateRequest');
const { requireRole, requireEventScope } = require('../../middlewares/auth');

router.use('/:eventId/activities', activityRoutes);
router.use('/:eventId/participants', participantRoutes);
router.use('/:eventId/qr', qrRoutes);

// Public / Authenticated read
router.get('/', eventController.getAllEvents);
router.get('/:eventId', eventController.getEventById);

// Organizer / Admin endpoints
router.post('/', requireRole('organizer', 'admin'), validateCreateEvent, validateRequest, eventController.createEvent);
router.patch('/:eventId', requireRole('organizer', 'admin'), eventController.updateEvent);
router.post('/:eventId/scanners', requireRole('organizer', 'admin'), eventController.assignScanners);
router.get('/:eventId/stats', requireRole('organizer', 'admin', 'scanner'), eventController.getEventStats);
router.delete('/:eventId', requireRole('admin', 'organizer'), eventController.deleteEvent);

// Attendance & Reports
router.get('/:eventId/attendance/report', requireRole('organizer', 'admin'), requireEventScope(), attendanceController.getAttendanceReport);
router.get('/:eventId/attendance/export', requireRole('organizer', 'admin'), requireEventScope(), attendanceController.exportAttendanceCsv);
router.post('/:eventId/attendance/points', requireRole('organizer', 'admin'), requireEventScope(), attendanceController.awardActivityPoints);

module.exports = router;
