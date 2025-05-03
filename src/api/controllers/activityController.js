const { v4: uuidv4 } = require('uuid');

const Activity = require('../../models/Activity');
const Event = require('../../models/Event');

const createActivity = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { name, type } = req.body;

    const qrId = uuidv4();

    const activity = new Activity({
      eventId,
      name,
      type,
      qrId
    });

    await activity.save();

    res.status(201).json({
      message: 'Activity created',
      activity,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create activity' });
  }
};

const getEventActivities = async (req, res) => {
  try {
    const { eventId } = req.params;

    const activities = await Activity.find({ eventId });

    if (!activities || activities.length === 0) {
      return res.status(404).json({ error: 'No activities found for this event' });
    }

    res.status(200).json({ activities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
};

const getActivityById = async (req, res) => {
  try {
    const { activityId } = req.params;

    const activity = await Activity.findById(activityId);

    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.status(200).json({ activity });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
}

const deleteActivity = async (req, res) => {
  try {
    const { activityId } = req.params;
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
  
    const activity = await Activity.findByIdAndDelete(activityId);

    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    if (activity.eventId.toString() !== eventId) {
      return res.status(403).json({ error: 'You do not have permission to delete this activity' });
    }

    //TODO: Handle deleting 
    
    res.status(200).json({ message: 'Activity deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete activity' });
  }
}

module.exports = {
  createActivity,
  getEventActivities,
  getActivityById,
};
