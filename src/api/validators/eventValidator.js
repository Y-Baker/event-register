const { body } = require('express-validator');

const validateCreateEvent = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required'),

  body('description')
    .trim()
    .notEmpty().withMessage('Description is required'),

  body('startDate')
    .optional({ nullable: true })
    .isISO8601().toDate().withMessage('Invalid start date format if provided'),

  body('endDate')
    .optional({ nullable: true })
    .isISO8601().toDate().withMessage('Invalid end date format if provided'),

  body('location')
    .trim()
    .notEmpty().withMessage('Location is required')
];

module.exports = {
  validateCreateEvent,
};
