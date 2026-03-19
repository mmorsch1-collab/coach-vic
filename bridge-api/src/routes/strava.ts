import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { SuccessResponse } from '../types.js';
import { stravaAuth } from '../services/stravaAuth.js';
import { logger } from '../logger.js';

const router = Router();

/**
 * Strava Activity interface
 */
interface StravaActivity {
  id: number;
  name: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  total_elevation_gain: number; // meters
  type: string; // Run, Ride, Swim, etc.
  sport_type: string;
  start_date: string; // ISO date
  start_date_local: string;
  timezone: string;
  average_speed: number; // m/s
  max_speed: number; // m/s
  average_heartrate?: number;
  max_heartrate?: number;
  elev_high?: number;
  elev_low?: number;
  calories?: number;
  description?: string;
  gear_id?: string;
}

/**
 * Strava Athlete interface
 */
interface StravaAthlete {
  id: number;
  username: string;
  firstname: string;
  lastname: string;
  city: string;
  state: string;
  country: string;
  sex: string;
  weight?: number;
  profile: string;
}

/**
 * GET /strava/athlete
 * Get authenticated athlete profile
 */
router.get(
  '/athlete',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Fetching Strava athlete profile');

    const isAuthenticated = await stravaAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/strava/start to connect your Strava account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      const athlete = await stravaAuth.makeApiRequest<StravaAthlete>('/athlete');

      const response: SuccessResponse<{ athlete: StravaAthlete }> = {
        success: true,
        data: {
          athlete,
        },
      };

      res.json(response);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch Strava athlete');

      if (error.message.includes('authenticate')) {
        throw new AppError(
          401,
          'Strava authentication expired. Please re-authenticate via /auth/strava/start',
          'TOKEN_EXPIRED'
        );
      }

      throw new AppError(
        500,
        `Failed to fetch Strava athlete: ${error.message}`,
        'STRAVA_API_ERROR'
      );
    }
  })
);

/**
 * GET /strava/activities
 * Get recent activities
 * Query params:
 *  - per_page: Number of activities per page (default: 30, max: 200)
 *  - page: Page number (default: 1)
 *  - before: Unix timestamp to get activities before
 *  - after: Unix timestamp to get activities after
 */
router.get(
  '/activities',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info('Fetching Strava activities');

    const isAuthenticated = await stravaAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/strava/start to connect your Strava account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      const perPage = Math.min(parseInt(req.query.per_page as string) || 30, 200);
      const page = parseInt(req.query.page as string) || 1;
      const before = req.query.before ? parseInt(req.query.before as string) : undefined;
      const after = req.query.after ? parseInt(req.query.after as string) : undefined;

      const queryParams = new URLSearchParams({
        per_page: perPage.toString(),
        page: page.toString(),
      });

      if (before) queryParams.append('before', before.toString());
      if (after) queryParams.append('after', after.toString());

      const activities = await stravaAuth.makeApiRequest<StravaActivity[]>(
        `/athlete/activities?${queryParams.toString()}`
      );

      logger.info({ count: activities.length }, 'Retrieved activities from Strava');

      const response: SuccessResponse<{
        activities: StravaActivity[];
        count: number;
        page: number;
        perPage: number;
      }> = {
        success: true,
        data: {
          activities,
          count: activities.length,
          page,
          perPage,
        },
      };

      res.json(response);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch Strava activities');

      if (error.message.includes('authenticate')) {
        throw new AppError(
          401,
          'Strava authentication expired. Please re-authenticate via /auth/strava/start',
          'TOKEN_EXPIRED'
        );
      }

      throw new AppError(
        500,
        `Failed to fetch Strava activities: ${error.message}`,
        'STRAVA_API_ERROR'
      );
    }
  })
);

/**
 * GET /strava/latest
 * Get latest activity (simplified endpoint for Coach Vic)
 */
router.get(
  '/latest',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Fetching latest Strava activity');

    const isAuthenticated = await stravaAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/strava/start to connect your Strava account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      const activities = await stravaAuth.makeApiRequest<StravaActivity[]>(
        '/athlete/activities?per_page=1&page=1'
      );

      if (!activities || activities.length === 0) {
        throw new AppError(404, 'No Strava activities found', 'NO_DATA');
      }

      const latest = activities[0];

      // Convert to more readable format
      const formatted = {
        id: latest.id,
        name: latest.name,
        type: latest.sport_type || latest.type,
        date: latest.start_date_local,
        distance: {
          meters: latest.distance,
          miles: latest.distance * 0.000621371,
          km: latest.distance / 1000,
        },
        duration: {
          seconds: latest.moving_time,
          formatted: formatDuration(latest.moving_time),
        },
        elevation: {
          gain: latest.total_elevation_gain,
          gainFeet: latest.total_elevation_gain * 3.28084,
        },
        pace: latest.type.toLowerCase().includes('run')
          ? {
              minPerMile: formatPace(latest.average_speed, 'imperial'),
              minPerKm: formatPace(latest.average_speed, 'metric'),
            }
          : undefined,
        speed: {
          mph: latest.average_speed * 2.23694,
          kph: latest.average_speed * 3.6,
        },
        heartRate: latest.average_heartrate
          ? {
              average: latest.average_heartrate,
              max: latest.max_heartrate,
            }
          : undefined,
        calories: latest.calories,
      };

      const response: SuccessResponse<{ activity: typeof formatted }> = {
        success: true,
        data: {
          activity: formatted,
        },
      };

      res.json(response);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch latest Strava activity');

      if (error.message.includes('authenticate')) {
        throw new AppError(
          401,
          'Strava authentication expired. Please re-authenticate via /auth/strava/start',
          'TOKEN_EXPIRED'
        );
      }

      throw new AppError(
        500,
        `Failed to fetch latest Strava activity: ${error.message}`,
        'STRAVA_API_ERROR'
      );
    }
  })
);

/**
 * GET /strava/activity/:id
 * Get detailed activity by ID
 */
router.get(
  '/activity/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const activityId = req.params.id;
    logger.info({ activityId }, 'Fetching Strava activity details');

    const isAuthenticated = await stravaAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/strava/start to connect your Strava account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      const activity = await stravaAuth.makeApiRequest<StravaActivity>(
        `/activities/${activityId}`
      );

      const response: SuccessResponse<{ activity: StravaActivity }> = {
        success: true,
        data: {
          activity,
        },
      };

      res.json(response);
    } catch (error: any) {
      logger.error({ err: error, activityId }, 'Failed to fetch Strava activity');

      if (error.message.includes('authenticate')) {
        throw new AppError(
          401,
          'Strava authentication expired. Please re-authenticate via /auth/strava/start',
          'TOKEN_EXPIRED'
        );
      }

      throw new AppError(
        500,
        `Failed to fetch Strava activity: ${error.message}`,
        'STRAVA_API_ERROR'
      );
    }
  })
);

/**
 * GET /strava/stats
 * Get athlete stats (totals and recent)
 */
router.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Fetching Strava athlete stats');

    const isAuthenticated = await stravaAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/strava/start to connect your Strava account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      // First get athlete to get their ID
      const athlete = await stravaAuth.makeApiRequest<StravaAthlete>('/athlete');

      // Then get stats using athlete ID
      const stats = await stravaAuth.makeApiRequest<any>(`/athletes/${athlete.id}/stats`);

      const response: SuccessResponse<{ stats: any }> = {
        success: true,
        data: {
          stats,
        },
      };

      res.json(response);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch Strava stats');

      if (error.message.includes('authenticate')) {
        throw new AppError(
          401,
          'Strava authentication expired. Please re-authenticate via /auth/strava/start',
          'TOKEN_EXPIRED'
        );
      }

      throw new AppError(
        500,
        `Failed to fetch Strava stats: ${error.message}`,
        'STRAVA_API_ERROR'
      );
    }
  })
);

/**
 * Helper: Format duration in seconds to HH:MM:SS
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Helper: Format pace (min/mile or min/km) from speed in m/s
 */
function formatPace(speedMs: number, unit: 'imperial' | 'metric'): string {
  const distanceInMeters = unit === 'imperial' ? 1609.34 : 1000;
  const paceSeconds = distanceInMeters / speedMs;
  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.floor(paceSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default router;
