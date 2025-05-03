const { body } = require('express-validator');

exports.validateCreateActivity = [
  body('name')
    .trim()
    .notEmpty().withMessage('Activity name is required'),

  body('type')
    .notEmpty().withMessage('Activity type is required')
    .isIn(['Check-In', 'Meal', 'Workshop', 'Talk'])
    .withMessage('Invalid activity type')
];
