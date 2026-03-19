import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { SuccessResponse } from '../types.js';
import { googleAuth } from '../services/googleAuth.js';
import { logger } from '../logger.js';

const router = Router();

// Calendar event interface
interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  attendees?: string[];
  description?: string;
  isAllDay: boolean;
}

interface TodayCalendar {
  date: string;
  events: CalendarEvent[];
  summary: {
    totalEvents: number;
    totalMinutes: number;
    firstEventTime?: string;
    lastEventTime?: string;
  };
}

/**
 * GET /calendar/today
 * Fetch today's calendar events from Google Calendar
 * Requires OAuth authentication via /auth/google/start
 */
router.get(
  '/today',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Fetching today\'s calendar events');

    // Check authentication
    const isAuthenticated = await googleAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/google/start to connect your Google account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      // Get authenticated client
      const auth = await googleAuth.getAuthenticatedClient();

      // Create Calendar API client
      const calendar = google.calendar({ version: 'v3', auth });

      // Get today's date range (midnight to midnight in user's timezone)
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      logger.debug({
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
      }, 'Fetching events for date range');

      // Fetch list of all calendars
      const calendarList = await calendar.calendarList.list();
      const calendars = calendarList.data.items || [];
      logger.info({ calendarCount: calendars.length }, 'Found calendars');

      // Fetch events from ALL calendars
      const allEventsPromises = calendars.map(async (cal) => {
        try {
          logger.debug({ calendarId: cal.id, calendarName: cal.summary }, 'Fetching from calendar');
          const response = await calendar.events.list({
            calendarId: cal.id!,
            timeMin: startOfDay.toISOString(),
            timeMax: endOfDay.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 50,
          });
          const events = response.data.items || [];
          logger.debug({
            calendarId: cal.id,
            calendarName: cal.summary,
            eventCount: events.length
          }, 'Fetched events from calendar');
          return events;
        } catch (error: any) {
          logger.warn({ calendarId: cal.id, calendarName: cal.summary, err: error }, 'Failed to fetch from calendar');
          return [];
        }
      });

      const eventsArrays = await Promise.all(allEventsPromises);
      const items = eventsArrays.flat();

      // Sort all events by start time
      items.sort((a, b) => {
        const aStart = a.start?.dateTime || a.start?.date || '';
        const bStart = b.start?.dateTime || b.start?.date || '';
        return aStart.localeCompare(bStart);
      });

      logger.info({ eventCount: items.length }, 'Retrieved calendar events from all calendars');

      // Transform events to our format
      const events: CalendarEvent[] = items.map((event) => {
        const start = event.start?.dateTime || event.start?.date;
        const end = event.end?.dateTime || event.end?.date;
        const isAllDay = !event.start?.dateTime;

        return {
          id: event.id || '',
          title: event.summary || '(No title)',
          startTime: start || '',
          endTime: end || '',
          location: event.location || undefined,
          attendees: event.attendees?.map((a) => a.email || '').filter(Boolean),
          description: event.description || undefined,
          isAllDay,
        };
      });

      // Calculate total minutes (excluding all-day events)
      let totalMinutes = 0;
      events.forEach((event) => {
        if (!event.isAllDay && event.startTime && event.endTime) {
          const start = new Date(event.startTime);
          const end = new Date(event.endTime);
          totalMinutes += (end.getTime() - start.getTime()) / (1000 * 60);
        }
      });

      const todayCalendar: TodayCalendar = {
        date: startOfDay.toISOString().split('T')[0],
        events,
        summary: {
          totalEvents: events.length,
          totalMinutes: Math.round(totalMinutes),
          firstEventTime: events[0]?.startTime,
          lastEventTime: events[events.length - 1]?.endTime,
        },
      };

      const apiResponse: SuccessResponse<TodayCalendar> = {
        success: true,
        data: todayCalendar,
      };

      res.json(apiResponse);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch calendar events');

      // Handle specific Google API errors
      if (error.code === 401) {
        throw new AppError(
          401,
          'OAuth token expired or invalid. Please re-authenticate via /auth/google/start',
          'TOKEN_EXPIRED'
        );
      }

      if (error.code === 403) {
        throw new AppError(
          403,
          'Insufficient permissions to access calendar. Please re-authenticate with proper permissions.',
          'INSUFFICIENT_PERMISSIONS'
        );
      }

      throw new AppError(
        500,
        `Failed to fetch calendar events: ${error.message}`,
        'CALENDAR_API_ERROR'
      );
    }
  })
);

/**
 * POST /calendar/events
 * Create a new calendar event
 * Body: { title, startTime, endTime, description?, location?, attendees? }
 */
router.post(
  '/events',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info({ body: req.body }, 'Creating calendar event');

    const isAuthenticated = await googleAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/google/start to connect your Google account.',
        'NOT_AUTHENTICATED'
      );
    }

    const { title, startTime, endTime, description, location, attendees } = req.body;

    if (!title || !startTime || !endTime) {
      throw new AppError(400, 'Missing required fields: title, startTime, endTime', 'INVALID_INPUT');
    }

    try {
      const auth = await googleAuth.getAuthenticatedClient();
      const calendar = google.calendar({ version: 'v3', auth });

      const timeZone = req.body.timeZone || 'America/New_York';

      const event = {
        summary: title,
        description: description || undefined,
        location: location || undefined,
        start: {
          dateTime: startTime,
          timeZone,
        },
        end: {
          dateTime: endTime,
          timeZone,
        },
        attendees: attendees ? attendees.map((email: string) => ({ email })) : undefined,
      };

      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });

      logger.info({ eventId: response.data.id }, 'Calendar event created');

      const apiResponse: SuccessResponse<{ id: string; link: string }> = {
        success: true,
        data: {
          id: response.data.id || '',
          link: response.data.htmlLink || '',
        },
      };

      res.status(201).json(apiResponse);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to create calendar event');
      throw new AppError(
        500,
        `Failed to create calendar event: ${error.message}`,
        'CALENDAR_API_ERROR'
      );
    }
  })
);

/**
 * PUT /calendar/events/:id
 * Update an existing calendar event
 * Body: { title?, startTime?, endTime?, description?, location?, attendees? }
 */
router.put(
  '/events/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    logger.info({ eventId: id, body: req.body }, 'Updating calendar event');

    const isAuthenticated = await googleAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/google/start to connect your Google account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      const auth = await googleAuth.getAuthenticatedClient();
      const calendar = google.calendar({ version: 'v3', auth });

      // Get existing event
      const existing = await calendar.events.get({
        calendarId: 'primary',
        eventId: id,
      });

      // Merge updates with existing data
      const { title, startTime, endTime, description, location, attendees } = req.body;

      const timeZone = req.body.timeZone || 'America/New_York';

      const updatedEvent = {
        ...existing.data,
        summary: title || existing.data.summary,
        description: description !== undefined ? description : existing.data.description,
        location: location !== undefined ? location : existing.data.location,
        start: startTime
          ? { dateTime: startTime, timeZone }
          : existing.data.start,
        end: endTime
          ? { dateTime: endTime, timeZone }
          : existing.data.end,
        attendees: attendees
          ? attendees.map((email: string) => ({ email }))
          : existing.data.attendees,
      };

      await calendar.events.update({
        calendarId: 'primary',
        eventId: id,
        requestBody: updatedEvent,
      });

      logger.info({ eventId: id }, 'Calendar event updated');

      const apiResponse: SuccessResponse<{ message: string }> = {
        success: true,
        data: { message: 'Event updated successfully' },
      };

      res.json(apiResponse);
    } catch (error: any) {
      logger.error({ err: error, eventId: id }, 'Failed to update calendar event');

      if (error.code === 404) {
        throw new AppError(404, 'Event not found', 'EVENT_NOT_FOUND');
      }

      throw new AppError(
        500,
        `Failed to update calendar event: ${error.message}`,
        'CALENDAR_API_ERROR'
      );
    }
  })
);

/**
 * DELETE /calendar/events/:id
 * Delete a calendar event
 */
router.delete(
  '/events/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    logger.info({ eventId: id }, 'Deleting calendar event');

    const isAuthenticated = await googleAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/google/start to connect your Google account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      const auth = await googleAuth.getAuthenticatedClient();
      const calendar = google.calendar({ version: 'v3', auth });

      await calendar.events.delete({
        calendarId: 'primary',
        eventId: id,
      });

      logger.info({ eventId: id }, 'Calendar event deleted');

      const apiResponse: SuccessResponse<{ message: string }> = {
        success: true,
        data: { message: 'Event deleted successfully' },
      };

      res.json(apiResponse);
    } catch (error: any) {
      logger.error({ err: error, eventId: id }, 'Failed to delete calendar event');

      if (error.code === 404) {
        throw new AppError(404, 'Event not found', 'EVENT_NOT_FOUND');
      }

      throw new AppError(
        500,
        `Failed to delete calendar event: ${error.message}`,
        'CALENDAR_API_ERROR'
      );
    }
  })
);

/**
 * GET /calendar/list
 * List all calendars the user has access to
 */
router.get(
  '/list',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Fetching calendar list');

    const isAuthenticated = await googleAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/google/start to connect your Google account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      const auth = await googleAuth.getAuthenticatedClient();
      const calendar = google.calendar({ version: 'v3', auth });

      // Fetch list of all calendars
      const calendarList = await calendar.calendarList.list();
      const calendars = calendarList.data.items || [];

      const calendarInfo = calendars.map((cal) => ({
        id: cal.id,
        name: cal.summary,
        description: cal.description,
        primary: cal.primary || false,
        accessRole: cal.accessRole,
        backgroundColor: cal.backgroundColor,
      }));

      logger.info({ calendarCount: calendars.length }, 'Retrieved calendar list');

      const apiResponse: SuccessResponse<{ calendars: typeof calendarInfo }> = {
        success: true,
        data: { calendars: calendarInfo },
      };

      res.json(apiResponse);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch calendar list');
      throw new AppError(
        500,
        `Failed to fetch calendar list: ${error.message}`,
        'CALENDAR_API_ERROR'
      );
    }
  })
);

export default router;
