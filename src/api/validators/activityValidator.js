const { body } = require('express-validator');

const ALLOWED_TYPES = [
  'check-in',
  'workshop',
  'meal',
  'talk',
  'keynote',
  'session',
  'exam',
  'general',
  'Check-In',
  'Meal',
  'Workshop',
  'Talk',
  'Keynote',
  'Session',
  'General',
];

exports.validateCreateActivity = [
  body('name')
    .trim()
    .notEmpty().withMessage('Activity name is required'),

  body('type')
    .notEmpty().withMessage('Activity type is required')
    .custom((val) => {
      if (!val || typeof val !== 'string') return false;
      const lower = val.trim().toLowerCase();
      return ALLOWED_TYPES.map(t => t.toLowerCase()).includes(lower);
    })
    .withMessage('Invalid activity type'),
];
