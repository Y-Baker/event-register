#!/usr/bin/node

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Activity = require('../../models/Activity');
const Event = require('../../models/Event');

const createActivity = async (req, res) => {
  try {
    const { eventId } = req.params;
    const {
      name,
      type,
      points,
      isLocked,
      checkInMode,
      description,
      order,
      isRestricted,
      allowedParticipantIds,
      allowedEmails,
    } = req.body || {};

    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Activity name is required' });
    }

    const qrId = `act_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    const activity = new Activity({
      eventId,
      name: name.trim(),
      type: type ? type.trim() : 'check-in',
      points: points !== undefined && points !== null ? Number(points) : 10,
      isLocked: Boolean(isLocked),
      checkInMode: checkInMode === 'self_service' ? 'self_service' : 'staff_scanner',
      qrId,
      description: description ? description.trim() : '',
      order: order !== undefined ? Number(order) : 0,
      isRestricted: Boolean(isRestricted),
      allowedParticipantIds: Array.isArray(allowedParticipantIds) ? allowedParticipantIds : [],
      allowedEmails: Array.isArray(allowedEmails) ? allowedEmails.map((e) => String(e).trim().toLowerCase()) : [],
      isActive: true,
    });

    await activity.save();

    return res.status(201).json({
      message: 'Activity created successfully',
      activity,
    });
  } catch (err) {
    console.error('Error creating activity:', err);
    return res.status(500).json({ error: 'Failed to create activity', details: err.message });
  }
};

const getEventActivities = async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const activities = await Activity.find({ eventId, isActive: { $ne: false } }).sort({ order: 1, createdAt: 1 });
    return res.status(200).json({ activities });
  } catch (err) {
    console.error('Error fetching activities:', err);
    return res.status(500).json({ error: 'Failed to fetch activities' });
  }
};

const getActivityById = async (req, res) => {
  try {
    const { activityId } = req.params;
    if (!mongoose.isValidObjectId(activityId)) {
      return res.status(400).json({ error: 'Invalid activityId format' });
    }

    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    return res.status(200).json({ activity });
  } catch (err) {
    console.error('Error fetching activity:', err);
    return res.status(500).json({ error: 'Failed to fetch activity' });
  }
};

const getActivityByQrId = async (req, res) => {
  try {
    const { qrId } = req.params;
    if (!qrId) {
      return res.status(400).json({ error: 'qrId is required' });
    }

    const activity = await Activity.findOne({ qrId, isActive: { $ne: false } }).populate('eventId', 'name description startDate endDate location bannerUrl coverImageUrl status isRegistrationOpen');
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    return res.status(200).json({
      activity: {
        id: String(activity._id),
        name: activity.name,
        type: activity.type,
        points: activity.points,
        isLocked: activity.isLocked,
        checkInMode: activity.checkInMode,
        qrId: activity.qrId,
        description: activity.description,
        isRestricted: activity.isRestricted,
        event: activity.eventId,
      },
    });
  } catch (err) {
    console.error('Error fetching activity by qrId:', err);
    return res.status(500).json({ error: 'Failed to fetch activity info' });
  }
};

const updateActivity = async (req, res) => {
  const { activityId } = req.params;
  try {
    if (!mongoose.isValidObjectId(activityId)) {
      return res.status(400).json({ error: 'Invalid activityId format' });
    }

    const body = req.body || {};
    const updates = {};

    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.type !== undefined) updates.type = body.type.trim();
    if (body.points !== undefined) updates.points = Number(body.points);
    if (body.description !== undefined) updates.description = body.description.trim();
    if (body.order !== undefined) updates.order = Number(body.order);
    if (body.isLocked !== undefined) updates.isLocked = Boolean(body.isLocked);
    if (body.isRestricted !== undefined) updates.isRestricted = Boolean(body.isRestricted);
    if (body.allowedParticipantIds !== undefined) {
      updates.allowedParticipantIds = Array.isArray(body.allowedParticipantIds) ? body.allowedParticipantIds : [];
    }
    if (body.allowedEmails !== undefined) {
      updates.allowedEmails = Array.isArray(body.allowedEmails) ? body.allowedEmails.map((e) => String(e).trim().toLowerCase()) : [];
    }
    if (body.checkInMode !== undefined) {
      updates.checkInMode = body.checkInMode === 'self_service' ? 'self_service' : 'staff_scanner';
    }

    const activity = await Activity.findByIdAndUpdate(activityId, { $set: updates }, { new: true });
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    return res.status(200).json({ message: 'Activity updated successfully', activity });
  } catch (err) {
    console.error('Error updating activity:', err);
    return res.status(500).json({ error: 'Failed to update activity' });
  }
};

const updateActivityWhitelist = async (req, res) => {
  const { activityId } = req.params;
  try {
    if (!mongoose.isValidObjectId(activityId)) {
      return res.status(400).json({ error: 'Invalid activityId format' });
    }

    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    const { isRestricted, participantIds, emails, append = false } = req.body || {};
    const updates = {};

    if (isRestricted !== undefined) {
      updates.isRestricted = Boolean(isRestricted);
    }

    if (Array.isArray(participantIds)) {
      const validIds = participantIds.filter((id) => mongoose.isValidObjectId(id));
      if (append) {
        const existingSet = new Set((activity.allowedParticipantIds || []).map(String));
        validIds.forEach((id) => existingSet.add(String(id)));
        updates.allowedParticipantIds = Array.from(existingSet);
      } else {
        updates.allowedParticipantIds = validIds;
      }
    }

    if (Array.isArray(emails)) {
      const cleanedEmails = emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
      if (append) {
        const existingSet = new Set((activity.allowedEmails || []).map((e) => e.toLowerCase()));
        cleanedEmails.forEach((e) => existingSet.add(e));
        updates.allowedEmails = Array.from(existingSet);
      } else {
        updates.allowedEmails = cleanedEmails;
      }
    }

    const updated = await Activity.findByIdAndUpdate(activityId, { $set: updates }, { new: true });

    return res.status(200).json({
      message: 'Activity whitelist updated successfully',
      activity: updated,
      totalWhitelistedCount: (updated.allowedParticipantIds?.length || 0) + (updated.allowedEmails?.length || 0),
    });
  } catch (err) {
    console.error('Error updating activity whitelist:', err);
    return res.status(500).json({ error: 'Failed to update whitelist', details: err.message });
  }
};

const toggleActivityLock = async (req, res) => {
  const { activityId } = req.params;
  try {
    if (!mongoose.isValidObjectId(activityId)) {
      return res.status(400).json({ error: 'Invalid activityId format' });
    }

    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    const newLockedState = req.body?.isLocked !== undefined ? Boolean(req.body.isLocked) : !activity.isLocked;
    const updated = await Activity.findByIdAndUpdate(
      activityId,
      { $set: { isLocked: newLockedState } },
      { new: true }
    );

    return res.status(200).json({
      message: `Activity ${newLockedState ? 'locked' : 'unlocked'} successfully`,
      activity: updated,
    });
  } catch (err) {
    console.error('Error toggling activity lock:', err);
    return res.status(500).json({ error: 'Failed to toggle activity lock' });
  }
};

const setActivityMode = async (req, res) => {
  const { activityId } = req.params;
  try {
    if (!mongoose.isValidObjectId(activityId)) {
      return res.status(400).json({ error: 'Invalid activityId format' });
    }

    const { checkInMode } = req.body || {};
    if (!['staff_scanner', 'self_service'].includes(checkInMode)) {
      return res.status(400).json({ error: 'Invalid mode. Allowed: staff_scanner, self_service' });
    }

    const activity = await Activity.findByIdAndUpdate(
      activityId,
      { $set: { checkInMode } },
      { new: true }
    );
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    return res.status(200).json({
      message: `Activity mode updated to ${checkInMode}`,
      activity,
    });
  } catch (err) {
    console.error('Error setting activity mode:', err);
    return res.status(500).json({ error: 'Failed to set activity mode' });
  }
};

const deleteActivity = async (req, res) => {
  try {
    const { activityId, eventId } = req.params;
    if (!mongoose.isValidObjectId(activityId)) {
      return res.status(400).json({ error: 'Invalid activityId format' });
    }

    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    if (eventId && activity.eventId.toString() !== eventId) {
      return res.status(403).json({ error: 'Activity does not belong to this event' });
    }

    await Activity.findByIdAndDelete(activityId);
    return res.status(200).json({ message: 'Activity deleted successfully' });
  } catch (err) {
    console.error('Error deleting activity:', err);
    return res.status(500).json({ error: 'Failed to delete activity' });
  }
};

module.exports = {
  createActivity,
  getEventActivities,
  getActivityById,
  getActivityByQrId,
  updateActivity,
  updateActivityWhitelist,
  toggleActivityLock,
  setActivityMode,
  deleteActivity,
};
