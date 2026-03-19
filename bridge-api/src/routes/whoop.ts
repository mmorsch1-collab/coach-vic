import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { SuccessResponse } from '../types.js';
import { whoopAuth } from '../services/whoopAuth.js';
import { logger } from '../logger.js';

const router = Router();

// WHOOP data interfaces
interface WhoopRecovery {
  score: number;
  resting_heart_rate: number;
  hrv_rmssd_milli: number;
  spo2_percentage?: number;
  skin_temp_celsius?: number;
  created_at?: string;
  updated_at?: string;
  score_state?: string;
}

interface WhoopSleep {
  id: string;
  start: string;
  end: string;
  duration_milli: number;
  created_at?: string;
  updated_at?: string;
  score_state?: string;
  timezone_offset?: string;
  nap?: boolean;
  score?: {
    stage_summary?: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count?: number;
      disturbance_count?: number;
    };
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
    respiratory_rate?: number;
    total_in_bed_time_milli?: number;
    latency_milli?: number;
    sleep_needed?: {
      baseline_milli?: number;
      need_from_sleep_debt_milli?: number;
      need_from_recent_strain_milli?: number;
      need_from_recent_nap_milli?: number;
      total_milli?: number;
    };
  };
}

interface WhoopCycle {
  id: string;
  start: string;
  end?: string;
  days: string[];
  recovery?: WhoopRecovery;
  sleep?: WhoopSleep;
  score?: {
    strain: number;
    kilojoules?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
  };
}

interface WhoopMorningBrief {
  date: string;
  recovery: {
    score: number | null;
    hrv: number | null;
    restingHeartRate: number | null;
    spo2?: number | null;
    skinTemp?: number | null;
    metadata?: {
      created_at?: string;
      updated_at?: string;
      score_state?: string;
    };
  };
  sleep: {
    durationHours: number;
    sleepScore?: number;
    inBedHours?: number;
    stages?: {
      awakeHours: number;
      lightSleepHours: number;
      slowWaveSleepHours: number;
      remSleepHours: number;
    };
    efficiency?: number;
    latency?: number;
    disturbances?: number;
    respiratoryRate?: number;
    sleepNeeded?: {
      baseline: number;
      debt: number;
      total: number;
    };
    metadata?: {
      start?: string;
      end?: string;
      created_at?: string;
      updated_at?: string;
      score_state?: string;
      timezone_offset?: string;
      nap?: boolean;
    };
  };
  strain: {
    score: number;
    kilojoules?: number;
    avgHeartRate?: number;
    maxHeartRate?: number;
  };
  recommendation: string;
}

/**
 * GET /whoop/today
 * Get today's WHOOP data (recovery, sleep, strain)
 */
router.get(
  '/today',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Fetching today\'s WHOOP data');

    // Check authentication
    const isAuthenticated = await whoopAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/whoop/start to connect your WHOOP account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      // Step 1: Get latest recovery data (v2 API)
      const recoveryResponse = await whoopAuth.makeApiRequest<{ records: any[] }>(
        `/recovery?limit=1`,
        'v2'
      );

      if (!recoveryResponse.records || recoveryResponse.records.length === 0) {
        throw new AppError(404, 'No WHOOP recovery data found', 'NO_DATA');
      }

      const latestRecovery = recoveryResponse.records[0];
      logger.info({ recovery: latestRecovery }, 'Retrieved recovery from WHOOP');

      // Step 2: Get the cycle for this recovery (v1 API)
      const cyclesResponse = await whoopAuth.makeApiRequest<{ records: WhoopCycle[] }>(
        `/cycle?limit=1`,
        'v1'
      );

      const latestCycle = cyclesResponse.records?.[0];
      logger.info({ cycle: latestCycle }, 'Retrieved cycle from WHOOP');

      // Transform recovery data and convert skin temp to Fahrenheit
      const skinTempC = latestRecovery.score?.skin_temp_celsius;
      const skinTempF = skinTempC ? (skinTempC * 9/5) + 32 : null;

      const recovery: WhoopRecovery = {
        score: latestRecovery.score?.recovery_score,
        resting_heart_rate: latestRecovery.score?.resting_heart_rate,
        hrv_rmssd_milli: latestRecovery.score?.hrv_rmssd_milli,
        spo2_percentage: latestRecovery.score?.spo2_percentage,
        skin_temp_celsius: skinTempF ?? undefined, // Actually Fahrenheit now
        created_at: latestRecovery.created_at,
        updated_at: latestRecovery.updated_at,
        score_state: latestRecovery.score_state,
      };

      // Step 3: Get latest sleep data (v2 API)
      let sleep: WhoopSleep | undefined;
      try {
        const sleepResponse = await whoopAuth.makeApiRequest<{ records: any[] }>(
          `/activity/sleep?limit=1`,
          'v2'
        );
        if (sleepResponse.records && sleepResponse.records.length > 0) {
          sleep = sleepResponse.records[0];
          logger.info({ sleep }, 'Retrieved sleep from WHOOP');
        } else {
          logger.warn('No sleep records found');
        }
      } catch (error: any) {
        logger.warn('Failed to fetch sleep data', { error: error.message });
      }

      const todayCycle = { ...latestCycle, recovery, sleep };

      // Transform to our format
      const today = new Date().toISOString().split('T')[0];

      // Calculate total sleep time (light + slow wave + REM)
      let sleepDurationHours = 0;
      let sleepStages = undefined;
      let sleepEfficiency = undefined;

      if (sleep?.score?.stage_summary) {
        const stages = sleep.score.stage_summary;
        const totalSleepMilli =
          (stages.total_light_sleep_time_milli || 0) +
          (stages.total_slow_wave_sleep_time_milli || 0) +
          (stages.total_rem_sleep_time_milli || 0);
        sleepDurationHours = totalSleepMilli / (1000 * 60 * 60);

        // Detailed sleep stage breakdown
        sleepStages = {
          awakeHours: (stages.total_awake_time_milli || 0) / (1000 * 60 * 60),
          lightSleepHours: (stages.total_light_sleep_time_milli || 0) / (1000 * 60 * 60),
          slowWaveSleepHours: (stages.total_slow_wave_sleep_time_milli || 0) / (1000 * 60 * 60),
          remSleepHours: (stages.total_rem_sleep_time_milli || 0) / (1000 * 60 * 60),
        };

        // Calculate sleep efficiency (actual sleep / time in bed)
        const totalInBedMilli = stages.total_in_bed_time_milli || 0;
        if (totalInBedMilli > 0) {
          sleepEfficiency = (totalSleepMilli / totalInBedMilli) * 100;
        }
      }

      const morningBrief: WhoopMorningBrief = {
        date: today,
        recovery: {
          score: recovery?.score || null,
          hrv: recovery?.hrv_rmssd_milli || null,
          restingHeartRate: recovery?.resting_heart_rate || null,
          spo2: recovery?.spo2_percentage || null,
          skinTemp: recovery?.skin_temp_celsius || null, // Already in Fahrenheit
          metadata: {
            created_at: recovery?.created_at,
            updated_at: recovery?.updated_at,
            score_state: recovery?.score_state,
          },
        },
        sleep: {
          durationHours: sleepDurationHours,
          sleepScore: sleep?.score?.sleep_performance_percentage,
          inBedHours: sleep?.score?.total_in_bed_time_milli
            ? sleep.score.total_in_bed_time_milli / (1000 * 60 * 60)
            : undefined,
          stages: sleepStages,
          efficiency: sleepEfficiency,
          latency: sleep?.score?.latency_milli
            ? sleep.score.latency_milli / (1000 * 60)
            : undefined,
          disturbances: sleep?.score?.stage_summary?.disturbance_count,
          respiratoryRate: sleep?.score?.respiratory_rate,
          sleepNeeded: sleep?.score?.sleep_needed ? {
            baseline: (sleep.score.sleep_needed.baseline_milli || 0) / (1000 * 60 * 60),
            debt: (sleep.score.sleep_needed.need_from_sleep_debt_milli || 0) / (1000 * 60 * 60),
            total: (sleep.score.sleep_needed.total_milli || 0) / (1000 * 60 * 60),
          } : undefined,
          metadata: sleep ? {
            start: sleep.start,
            end: sleep.end,
            created_at: sleep.created_at,
            updated_at: sleep.updated_at,
            score_state: sleep.score_state,
            timezone_offset: sleep.timezone_offset,
            nap: sleep.nap,
          } : undefined,
        },
        strain: {
          score: latestCycle?.score?.strain || 0,
          kilojoules: latestCycle?.score?.kilojoules,
          avgHeartRate: latestCycle?.score?.average_heart_rate,
          maxHeartRate: latestCycle?.score?.max_heart_rate,
        },
        recommendation: generateRecommendation(todayCycle),
      };

      const response: SuccessResponse<WhoopMorningBrief> = {
        success: true,
        data: morningBrief,
      };

      res.json(response);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch WHOOP data');

      if (error.code === 401 || error.message.includes('401')) {
        throw new AppError(
          401,
          'WHOOP authentication expired. Please re-authenticate via /auth/whoop/start',
          'TOKEN_EXPIRED'
        );
      }

      throw new AppError(
        500,
        `Failed to fetch WHOOP data: ${error.message}`,
        'WHOOP_API_ERROR'
      );
    }
  })
);

/**
 * Generate simple recommendation based on recovery score
 */
function generateRecommendation(cycle: WhoopCycle): string {
  const recoveryScore = cycle.recovery?.score;

  if (!recoveryScore) {
    return 'Recovery data not yet available. Check back later or ensure you wore your WHOOP last night.';
  }

  if (recoveryScore >= 67) {
    return 'Your recovery is excellent. This is a great day for high intensity training or important meetings.';
  } else if (recoveryScore >= 34) {
    return 'Your recovery is moderate. Consider light to moderate activity and avoid overexertion.';
  } else {
    return 'Your recovery is low. Focus on rest, light movement, and stress management today.';
  }
}

/**
 * GET /whoop/morning-brief (legacy endpoint, redirects to /today)
 */
router.get(
  '/morning-brief',
  asyncHandler(async (_req: Request, res: Response) => {
    // Redirect to /today
    res.redirect(307, '/whoop/today');
  })
);

export default router;
