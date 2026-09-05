#!/usr/bin/node

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Event = require('../../models/Event');
const Activity = require('../../models/Activity');
const Participant = require('../../models/Participant');

const createEvent = async (req, res) => {
  try {
    const {
      name,
      description,
      date,
      startDate,
      endDate,
      location,
      venue,
      category,
      bannerUrl,
      coverImageUrl,
      capacity,
      isRegistrationOpen,
      allowedAudience,
      allowedCommitteeIds,
      points,
      customFields,
      scannerUserIds,
      status,
    } = req.body || {};

    if (!name || !description || !location) {
      return res.status(400).json({ error: 'Name, description, and location are required' });
    }

    const event = new Event({
      name: name.trim(),
      description: description.trim(),
      date: date ? new Date(date) : (startDate ? new Date(startDate) : new Date()),
      startDate: startDate ? new Date(startDate) : (date ? new Date(date) : null),
      endDate: endDate ? new Date(endDate) : null,
      location: location.trim(),
      venue: venue ? venue.trim() : location.trim(),
      category: category ? category.trim() : 'General',
      bannerUrl: bannerUrl || null,
      coverImageUrl: coverImageUrl || bannerUrl || null,
      capacity: capacity !== undefined && capacity !== null && capacity !== '' ? Number(capacity) : null,
      isRegistrationOpen: isRegistrationOpen !== undefined ? Boolean(isRegistrationOpen) : true,
      allowedAudience: allowedAudience || 'public',
      allowedCommitteeIds: Array.isArray(allowedCommitteeIds) ? allowedCommitteeIds : [],
      points: points !== undefined && points !== null ? Number(points) : 25,
      customFields: Array.isArray(customFields) ? customFields : [],
      scannerUserIds: Array.isArray(scannerUserIds) ? scannerUserIds : [],
      status: status || 'published',
    });

    await event.save();

    // Automatically create default "Main Check-In" activity
    const defaultActivity = new Activity({
      eventId: event._id,
      name: 'Main Check-In',
      type: 'check-in',
      points: event.points || 25,
      isLocked: false,
      checkInMode: 'staff_scanner',
      qrId: `act_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
      description: 'Primary event check-in and attendance confirmation',
      order: 0,
    });
    await defaultActivity.save();

    return res.status(201).json({
      message: 'Event created successfully',
      event,
      defaultActivity,
    });
  } catch (err) {
    console.error('Error creating event:', err);
    return res.status(500).json({ error: 'Failed to create event', details: err.message });
  }
};

const getAllEvents = async (req, res) => {
  try {
    const { status, category, audience } = req.query;
    const filter = {};

    if (status) {
      filter.status = status;
    }
    if (category && category !== 'All') {
      filter.category = new RegExp(`^${category}$`, 'i');
    }
    if (audience) {
      filter.allowedAudience = audience;
    }

    const events = await Event.find(filter).sort({ date: -1, createdAt: -1 }).lean();

    // Enrich events with counts
    const eventIds = events.map((e) => e._id);
    const [activityCounts, participantCounts] = await Promise.all([
      Activity.aggregate([
        { $match: { eventId: { $in: eventIds }, isActive: { $ne: false } } },
        { $group: { _id: '$eventId', count: { $sum: 1 } } },
      ]),
      Participant.aggregate([
        { $match: { eventId: { $in: eventIds } } },
        {
          $group: {
            _id: '$eventId',
            total: { $sum: 1 },
            checkedIn: {
              $sum: {
                $cond: [{ $gt: [{ $size: { $ifNull: ['$scannedActivities', []] } }, 0] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    const actMap = new Map(activityCounts.map((a) => [String(a._id), a.count]));
    const partMap = new Map(participantCounts.map((p) => [String(p._id), p]));

    const enriched = events.map((event) => {
      const idStr = String(event._id);
      const pStats = partMap.get(idStr) || { total: 0, checkedIn: 0 };
      return {
        ...event,
        id: idStr,
        activitiesCount: actMap.get(idStr) || 0,
        registeredCount: pStats.total,
        checkedInCount: pStats.checkedIn,
      };
    });

    return res.status(200).json({ events: enriched });
  } catch (err) {
    console.error('Error fetching events:', err);
    return res.status(500).json({ error: 'Failed to fetch events' });
  }
};

const getEventById = async (req, res) => {
  const { eventId } = req.params;
  try {
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const event = await Event.findById(eventId).lean();
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const [activities, participantStats] = await Promise.all([
      Activity.find({ eventId, isActive: { $ne: false } }).sort({ order: 1, createdAt: 1 }).lean(),
      Participant.aggregate([
        { $match: { eventId: new mongoose.Types.ObjectId(eventId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            checkedIn: {
              $sum: {
                $cond: [{ $gt: [{ $size: { $ifNull: ['$scannedActivities', []] } }, 0] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    const pStats = participantStats[0] || { total: 0, checkedIn: 0 };

    return res.status(200).json({
      event: {
        ...event,
        id: String(event._id),
        activities,
        registeredCount: pStats.total,
        checkedInCount: pStats.checkedIn,
      },
    });
  } catch (err) {
    console.error('Error fetching event by ID:', err);
    return res.status(500).json({ error: 'Failed to fetch event' });
  }
};

const updateEvent = async (req, res) => {
  const { eventId } = req.params;
  try {
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const body = req.body || {};
    const updates = {};

    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.description !== undefined) updates.description = body.description.trim();
    if (body.date !== undefined) updates.date = new Date(body.date);
    if (body.startDate !== undefined) updates.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.endDate !== undefined) updates.endDate = body.endDate ? new Date(body.endDate) : null;
    if (body.location !== undefined) updates.location = body.location.trim();
    if (body.venue !== undefined) updates.venue = body.venue ? body.venue.trim() : null;
    if (body.category !== undefined) updates.category = body.category ? body.category.trim() : 'General';
    if (body.bannerUrl !== undefined) updates.bannerUrl = body.bannerUrl || null;
    if (body.coverImageUrl !== undefined) updates.coverImageUrl = body.coverImageUrl || null;
    if (body.capacity !== undefined) updates.capacity = body.capacity !== null && body.capacity !== '' ? Number(body.capacity) : null;
    if (body.isRegistrationOpen !== undefined) updates.isRegistrationOpen = Boolean(body.isRegistrationOpen);
    if (body.allowedAudience !== undefined) updates.allowedAudience = body.allowedAudience;
    if (body.allowedCommitteeIds !== undefined) updates.allowedCommitteeIds = Array.isArray(body.allowedCommitteeIds) ? body.allowedCommitteeIds : [];
    if (body.points !== undefined) updates.points = Number(body.points);
    if (body.customFields !== undefined) updates.customFields = Array.isArray(body.customFields) ? body.customFields : [];
    if (body.scannerUserIds !== undefined) updates.scannerUserIds = Array.isArray(body.scannerUserIds) ? body.scannerUserIds : [];
    if (body.status !== undefined) updates.status = body.status;

    const event = await Event.findByIdAndUpdate(eventId, { $set: updates }, { new: true });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    return res.status(200).json({ message: 'Event updated successfully', event });
  } catch (err) {
    console.error('Error updating event:', err);
    return res.status(500).json({ error: 'Failed to update event', details: err.message });
  }
};

const assignScanners = async (req, res) => {
  const { eventId } = req.params;
  try {
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const { scannerUserIds } = req.body || {};
    if (!Array.isArray(scannerUserIds)) {
      return res.status(400).json({ error: 'scannerUserIds must be an array of user IDs' });
    }

    const event = await Event.findByIdAndUpdate(
      eventId,
      { $set: { scannerUserIds } },
      { new: true }
    );
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    return res.status(200).json({ message: 'Scanners assigned successfully', scannerUserIds: event.scannerUserIds });
  } catch (err) {
    console.error('Error assigning scanners:', err);
    return res.status(500).json({ error: 'Failed to assign scanners' });
  }
};

const getEventStats = async (req, res) => {
  const { eventId } = req.params;
  try {
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const event = await Event.findById(eventId).lean();
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const [activities, participants] = await Promise.all([
      Activity.find({ eventId, isActive: { $ne: false } }).lean(),
      Participant.find({ eventId }).lean(),
    ]);

    const totalRegistered = participants.length;
    let totalCheckedIn = 0;
    let totalPointsDistributed = 0;
    const activityScanCounts = {};

    activities.forEach((act) => {
      activityScanCounts[String(act._id)] = {
        activityId: String(act._id),
        name: act.name,
        type: act.type,
        points: act.points || 0,
        isLocked: Boolean(act.isLocked),
        checkInMode: act.checkInMode || 'staff_scanner',
        scannedCount: 0,
      };
    });

    participants.forEach((p) => {
      const scans = p.scannedActivities || [];
      if (scans.length > 0) {
        totalCheckedIn += 1;
      }
      totalPointsDistributed += (p.pointsAwarded || 0);

      scans.forEach((scan) => {
        const actIdStr = String(scan.activityId);
        if (activityScanCounts[actIdStr]) {
          activityScanCounts[actIdStr].scannedCount += 1;
        }
      });
    });

    const capacityPercent = event.capacity && event.capacity > 0
      ? Math.min(100, Math.round((totalRegistered / event.capacity) * 100))
      : null;

    const checkInRatePercent = totalRegistered > 0
      ? Math.round((totalCheckedIn / totalRegistered) * 100)
      : 0;

    return res.status(200).json({
      stats: {
        eventId: String(event._id),
        eventName: event.name,
        totalRegistered,
        totalCheckedIn,
        capacity: event.capacity,
        capacityPercent,
        checkInRatePercent,
        totalPointsDistributed,
        activitiesCount: activities.length,
        activities: Object.values(activityScanCounts),
      },
    });
  } catch (err) {
    console.error('Error fetching event stats:', err);
    return res.status(500).json({ error: 'Failed to fetch event stats' });
  }
};

const deleteEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const event = await Event.findByIdAndDelete(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Clean up activities and participants
    await Promise.all([
      Activity.deleteMany({ eventId }),
      Participant.deleteMany({ eventId }),
    ]);

    return res.status(200).json({ message: 'Event and associated records deleted successfully' });
  } catch (err) {
    console.error('Error deleting event:', err);
    return res.status(500).json({ error: 'Failed to delete event' });
  }
};

module.exports = {
  createEvent,
  getAllEvents,
  getEventById,
  updateEvent,
  assignScanners,
  getEventStats,
  deleteEvent,
};
