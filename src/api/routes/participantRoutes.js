const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const participantController = require('../controllers/participantController');
const { validateParticipant } = require('../validators/participantValidator');
const validateRequest = require('../../middlewares/validateRequest');
const { requireRole } = require('../../middlewares/auth');


router.post('/', requireRole('organizer', 'admin'), validateParticipant, validateRequest, participantController.addParticipant);
router.get('/', requireRole('organizer', 'admin'), participantController.getEventParticipants);
router.get('/:participantId', requireRole('organizer', 'admin'), participantController.getParticipantById);

// Bulk registration via CSV
router.post('/upload', requireRole('organizer', 'admin'), upload.single('file'), participantController.uploadCSV);

module.exports = router;
