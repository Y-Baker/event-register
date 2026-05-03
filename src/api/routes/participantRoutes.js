const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.resolve(__dirname, '../../../uploads');
if (!fs.existsSync(uploadsDir)) {
	fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, uploadsDir);
	},
	filename: function (req, file, cb) {
		const timestamp = Date.now();
		const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
		cb(null, `${timestamp}-${safeName}`);
	}
});

const fileFilter = (req, file, cb) => {
	if (file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel') {
		cb(null, true);
	} else {
		cb(new Error('Only CSV files are allowed'));
	}
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

const participantController = require('../controllers/participantController');
const { validateParticipant } = require('../validators/participantValidator');
const validateRequest = require('../../middlewares/validateRequest');
const { requireRole, requireEventScope } = require('../../middlewares/auth');


router.post('/', requireRole('organizer', 'admin'), requireEventScope(), validateParticipant, validateRequest, participantController.addParticipant);
router.get('/', requireRole('organizer', 'admin'), requireEventScope(), participantController.getEventParticipants);

// Bulk registration via CSV
router.post('/upload', requireRole('organizer', 'admin'), requireEventScope(), upload.single('file'), participantController.uploadCSV);

router.get('/:participantId', requireRole('organizer', 'admin'), requireEventScope(), participantController.getParticipantById);

module.exports = router;
