const { body } = require('express-validator');
const { validationResult } = require('express-validator');
const Participant = require('../../models/Participant');

const validateParticipant = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 3 }).withMessage('Name must be at least 3 characters long'),
  
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format'),

  body('phoneNumber')
    .trim()
    .optional({ nullable: true })
    .isLength({ min: 10, max: 15 }).withMessage('Invalid phone number length'),

  body('university')
    .trim()
    .optional({ nullable: true }),

  body('faculty')
    .trim()
    .optional({ nullable: true }),

  body('major')
    .trim()
    .optional({ nullable: true }),
];

const validateParticipantObject = async (data) => {
  const { participant, eventId } = data;
  const req = { body: participant };
  for (const validator of validateParticipant) {
    await validator.run(req);
  }

  const exists = await Participant.findOne({ email: participant.email, eventId });
  if (exists) {
    return [{ field: 'email', message: 'Email already registered for this event' }];
  }

  const result = validationResult(req);
  if (!result.isEmpty()) {
    return result.array().map(e => ({ field: e.param, message: e.msg }));
  }

  return null;
};

module.exports = {
  validateParticipant,
  validateParticipantObject
};
