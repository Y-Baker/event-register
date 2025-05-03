#!/usr/bin/node

const Event = require('../../models/Event');

const createEvent = async (req, res) => {
  try {
    const { name, description, date, location } = req.body;

    const event = new Event({ name, description, date, location });
    await event.save();

    res.status(201).json({ message: 'Event created', event });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create event' });
  }
};

const getAllEvents = async (req, res) => {
  try {
    const events = await Event.find();
    if (!events || events.length === 0) {
      return res.status(404).json({ error: 'No events found' });
    }
    res.status(200).json({ events });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
};

const getEventById = async (req, res) => {
  const { eventId } = req.params;
  try {
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.status(200).json({ event });
  }
  catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
}

const deleteEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findByIdAndDelete(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.status(200).json({ message: 'Event deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
}


module.exports = {
  createEvent,
  getAllEvents,
  getEventById,
  deleteEvent
};
