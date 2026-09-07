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
  },
});

const fileFilter = (req, file, cb) => {
  const isCsvExt = file.originalname && file.originalname.toLowerCase().endsWith('.csv');
  const allowedMimes = ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv', 'text/x-csv', 'application/octet-stream'];
  if (isCsvExt || allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only CSV files are allowed'));
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

const handleMulterUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[CSV Upload Multer Error]:', err.message);
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    next();
  });
};

const participantController = require('../controllers/participantController');
const { requireRole, requireEventScope } = require('../../middlewares/auth');

// Public / Attendee registration (checks eligibility & capacity inside controller)
router.post('/', participantController.addParticipant);

// Organizer / Staff endpoints
router.get('/', requireRole('organizer', 'scanner', 'admin'), requireEventScope(), participantController.getEventParticipants);
router.post('/upload', requireRole('organizer', 'admin'), requireEventScope(), handleMulterUpload, participantController.uploadCSV);
router.post('/:participantId/check-in', requireRole('organizer', 'scanner', 'admin'), requireEventScope(), participantController.checkInParticipantManual);
router.post('/:participantId/reset-checkin', requireRole('organizer', 'admin'), requireEventScope(), participantController.resetParticipantCheckIn);
router.get('/:participantId', requireRole('organizer', 'scanner', 'admin'), requireEventScope(), participantController.getParticipantById);
router.delete('/:participantId', requireRole('organizer', 'admin'), requireEventScope(), participantController.deleteParticipant);

module.exports = router;
