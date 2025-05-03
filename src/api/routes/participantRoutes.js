const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const participantController = require('../controllers/participantController');
const { validateParticipant } = require('../validators/participantValidator');
const validateRequest = require('../../middlewares/validateRequest');


router.post('/', validateParticipant, validateRequest, participantController.addParticipant);
router.get('/', participantController.getEventParticipants);
router.get('/:participantId', participantController.getParticipantById);

// Bulk registration via CSV
router.post('/upload', upload.single('file'), participantController.uploadCSV);

module.exports = router;
