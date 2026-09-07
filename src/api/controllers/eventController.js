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
      customFields,
      scannerUserIds,
      status,
      initialActivities,
    } = req.body || {};

    if (!name || !description || !location) {
      return res.status(400).json({ error: 'Name, description, and location are required' });
    }

    const event = new Event({
      name: name.trim(),
      description: description.trim(),
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      location: location.trim(),
      venue: venue ? venue.trim() : location.trim(),
      category: category ? category.trim() : 'General',
      bannerUrl: bannerUrl || null,
      coverImageUrl: coverImageUrl || bannerUrl || null,
      capacity: capacity !== undefined && capacity !== null && capacity !== '' ? Number(capacity) : -1,
      isRegistrationOpen: isRegistrationOpen !== undefined ? Boolean(isRegistrationOpen) : true,
      allowedAudience: allowedAudience || 'public',
      allowedCommitteeIds: Array.isArray(allowedCommitteeIds) ? allowedCommitteeIds : [],
      customFields: Array.isArray(customFields) ? customFields : [],
      scannerUserIds: Array.isArray(scannerUserIds) ? scannerUserIds : [],
      status: status || 'published',
    });

    await event.save();

    const createdActivities = [];

    // Check if client provided custom initial activities from the multi-stage creator
    if (Array.isArray(initialActivities) && initialActivities.length > 0) {
      for (let i = 0; i < initialActivities.length; i++) {
        const act = initialActivities[i];
        if (act.name && act.name.trim()) {
          const newAct = new Activity({
            eventId: event._id,
            name: act.name.trim(),
            type: act.type ? act.type.trim() : 'check-in',
            points: act.points !== undefined && act.points !== null ? Number(act.points) : 15,
            isLocked: Boolean(act.isLocked),
            checkInMode: act.checkInMode === 'self_service' ? 'self_service' : 'staff_scanner',
            qrId: `act_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
            description: act.description ? act.description.trim() : '',
            order: i,
            isRestricted: Boolean(act.isRestricted),
            allowedEmails: Array.isArray(act.allowedEmails) ? act.allowedEmails.map((e) => String(e).trim().toLowerCase()) : [],
          });
          await newAct.save();
          createdActivities.push(newAct);
        }
      }
    }

    // If no activities were provided, automatically create default "Main Check-In" activity
    if (createdActivities.length === 0) {
      const defaultActivity = new Activity({
        eventId: event._id,
        name: 'Main Check-In',
        type: 'check-in',
        points: 25,
        isLocked: false,
        checkInMode: 'staff_scanner',
        qrId: `act_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
        description: 'Primary event check-in and attendance confirmation',
        order: 0,
      });
      await defaultActivity.save();
      createdActivities.push(defaultActivity);
    }

    return res.status(201).json({
      message: 'Event created successfully',
      event,
      activities: createdActivities,
      defaultActivity: createdActivities[0],
    });
  } catch (err) {
    console.error('Error creating event:', err);
    return res.status(500).json({ error: 'Failed to create event', details: err.message });
  }
};

function isEventConcluded(event, now = new Date()) {
  const targetDateStr = event.endDate || event.startDate || event.date;
  if (!targetDateStr) return false;
  const targetDate = new Date(targetDateStr);
  if (isNaN(targetDate.getTime())) return false;
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);
  return now.getTime() > endOfDay.getTime();
}

const getAllEvents = async (req, res) => {
  try {
    const { status, category, audience } = req.query;
    const filter = {};

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    if (status === 'archived') {
      filter.status = 'archived';
    } else if (status === 'past') {
      filter.status = { $ne: 'archived' };
      filter.$or = [
        { status: { $in: ['past', 'completed'] } },
        { endDate: { $lt: todayStart } },
        { $and: [{ endDate: null }, { startDate: { $lt: todayStart } }] },
        { $and: [{ endDate: null }, { startDate: null }, { date: { $lt: todayStart } }] },
      ];
    } else if (status === 'active') {
      filter.status = { $ne: 'archived' };
      filter.$or = [
        { endDate: { $gte: todayStart } },
        { $and: [{ endDate: null }, { startDate: { $gte: todayStart } }] },
        { $and: [{ endDate: null }, { startDate: null }, { date: { $gte: todayStart } }] },
        { $and: [{ endDate: null }, { startDate: null }, { date: null }] },
      ];
    } else if (status && status !== 'all' && status !== '*') {
      filter.status = status;
    } else {
      // By default or 'all', exclude archived events
      filter.status = { $ne: 'archived' };
    }

    if (category && category !== 'All' && category !== 'all') {
      filter.category = new RegExp(`^${category}$`, 'i');
    }
    if (audience) {
      filter.allowedAudience = audience;
    }

    const events = await Event.find(filter).lean();

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
      const isArchived = event.status === 'archived';
      const isPast = !isArchived && isEventConcluded(event, now);
      const dynamicStatus = isArchived ? 'archived' : (isPast ? 'past' : 'active');

      return {
        ...event,
        id: idStr,
        status: dynamicStatus,
        isPast,
        activitiesCount: actMap.get(idStr) || 0,
        registeredCount: pStats.total,
        checkedInCount: pStats.checkedIn,
      };
    });

    // Smart Event Order:
    // 1. Active / upcoming events first (nearest date to today first)
    // 2. Concluded / past events second (most recent past date first)
    // 3. Fallback to createdAt descending
    const sorted = [...enriched].sort((a, b) => {
      const aConcluded = Boolean(a.isPast || a.status === 'past');
      const bConcluded = Boolean(b.isPast || b.status === 'past');

      // Active before past
      if (!aConcluded && bConcluded) return -1;
      if (aConcluded && !bConcluded) return 1;

      const aDate = a.startDate || a.date || a.endDate;
      const bDate = b.startDate || b.date || b.endDate;
      const aTime = aDate ? new Date(aDate).getTime() : null;
      const bTime = bDate ? new Date(bDate).getTime() : null;

      // Both active: closest date first (ascending)
      if (!aConcluded && !bConcluded) {
        if (aTime !== null && bTime !== null && aTime !== bTime) {
          return aTime - bTime;
        }
      }

      // Both past: most recent past event first (descending)
      if (aConcluded && bConcluded) {
        if (aTime !== null && bTime !== null && aTime !== bTime) {
          return bTime - aTime;
        }
      }

      // One has a date, the other does not
      if (aTime !== null && bTime === null) return -1;
      if (aTime === null && bTime !== null) return 1;

      // Open registration preference
      const aOpen = Boolean(a.isRegistrationOpen);
      const bOpen = Boolean(b.isRegistrationOpen);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;

      // Tie-breaker: creation date descending
      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bCreated - aCreated;
    });

    return res.status(200).json({ events: sorted });
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

const getGlobalStats = async (req, res) => {
  try {
    const nonArchivedFilter = { status: { $ne: 'archived' } };

    const [eventCount, participantStats] = await Promise.all([
      Event.countDocuments(nonArchivedFilter),
      Participant.aggregate([
        {
          $lookup: {
            from: 'events',
            localField: 'eventId',
            foreignField: '_id',
            as: 'event',
          },
        },
        { $unwind: '$event' },
        { $match: { 'event.status': { $ne: 'archived' } } },
        {
          $group: {
            _id: null,
            totalRegistrations: { $sum: 1 },
            totalCheckedIn: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$status', 'checked_in'] },
                      { $gt: [{ $size: { $ifNull: ['$scannedActivities', []] } }, 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            totalPoints: { $sum: { $ifNull: ['$pointsAwarded', 0] } },
          },
        },
      ]),
    ]);

    const stats = participantStats[0] || {
      totalRegistrations: 0,
      totalCheckedIn: 0,
      totalPoints: 0,
    };

    const payload = {
      totalEvents: eventCount,
      totalRegistrations: stats.totalRegistrations || 0,
      totalCheckedIn: stats.totalCheckedIn || 0,
      totalPoints: stats.totalPoints || 0,
    };

    return res.status(200).json({
      success: true,
      stats: payload,
      kpis: payload,
    });
  } catch (err) {
    console.error('Error calculating global stats:', err);
    return res.status(500).json({ error: 'Failed to retrieve global stats', details: err.message });
  }
};

const getGlobalKPIs = getGlobalStats;

module.exports = {
  createEvent,
  getAllEvents,
  getEventById,
  updateEvent,
  assignScanners,
  getEventStats,
  deleteEvent,
  getGlobalStats,
  getGlobalKPIs,
};
