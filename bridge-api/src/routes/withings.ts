import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { SuccessResponse } from '../types.js';
import { withingsAuth } from '../services/withingsAuth.js';
import { logger } from '../logger.js';

const router = Router();

// Withings measurement types
// See: https://developer.withings.com/api-reference/#tag/measure
enum MeasureType {
  Weight = 1,
  Height = 4,
  FatFreeMass = 5,
  FatRatio = 6,
  FatMassWeight = 8,
  DiastolicBloodPressure = 9,
  SystolicBloodPressure = 10,
  HeartRate = 11,
  Temperature = 12,
  SpO2 = 54,
  BodyTemperature = 71,
  SkinTemperature = 73,
  MuscleMass = 76,
  Hydration = 77,
  BoneMass = 88,
  PulseWaveVelocity = 91,
  VO2Max = 123,
  ExtracellularWater = 168,
  IntracellularWater = 169,
  VisceralFat = 170,
  MetabolicAge = 176,
}

interface WithingsMeasurement {
  value: number;
  type: MeasureType;
  unit: number; // Power of 10 multiplier (e.g., -3 means divide by 1000)
  algo?: number;
  fm?: number;
}

interface WithingsMeasureGroup {
  grpid: number;
  attrib: number; // 0 = device measured, 1 = manually entered, 2 = auto, 4 = creation, 7 = confirmed
  date: number; // Unix timestamp
  created: number; // Unix timestamp
  modified: number; // Unix timestamp
  category: number; // 1 = real, 2 = user objective
  deviceid: string;
  hash_deviceid: string;
  measures: WithingsMeasurement[];
  comment?: string;
  timezone?: string;
}

interface WithingsMeasureResponse {
  updatetime: number; // Unix timestamp of last update
  timezone: string;
  measuregrps: WithingsMeasureGroup[];
  more?: number; // 1 if more data available
  offset?: number;
}

interface ProcessedMeasurement {
  weight?: {
    kg: number;
    lbs: number;
    metadata: MeasurementMetadata;
  };
  bodyFat?: {
    percentage: number;
    massKg: number;
    massLbs: number;
    metadata: MeasurementMetadata;
  };
  muscleMass?: {
    kg: number;
    lbs: number;
    percentage?: number;
    metadata: MeasurementMetadata;
  };
  boneMass?: {
    kg: number;
    lbs: number;
    metadata: MeasurementMetadata;
  };
  hydration?: {
    percentage: number;
    metadata: MeasurementMetadata;
  };
  visceralFat?: {
    rating: number;
    metadata: MeasurementMetadata;
  };
  bmi?: number;
  heartRate?: {
    bpm: number;
    metadata: MeasurementMetadata;
  };
  bloodPressure?: {
    systolic: number;
    diastolic: number;
    metadata: MeasurementMetadata;
  };
  temperature?: {
    celsius: number;
    fahrenheit: number;
    metadata: MeasurementMetadata;
  };
  spo2?: {
    percentage: number;
    metadata: MeasurementMetadata;
  };
  metabolicAge?: {
    years: number;
    metadata: MeasurementMetadata;
  };
  rawData: WithingsMeasureGroup;
}

interface MeasurementMetadata {
  measuredAt: string; // ISO timestamp
  createdAt: string; // ISO timestamp
  modifiedAt: string; // ISO timestamp
  source: 'device' | 'manual' | 'auto' | 'creation' | 'confirmed';
  deviceId: string;
  category: 'measurement' | 'objective';
  timezone?: string;
  comment?: string;
}

/**
 * Helper: Convert measurement value using unit multiplier
 */
function convertValue(value: number, unit: number): number {
  return value * Math.pow(10, unit);
}

/**
 * Helper: Get measurement source from attrib field
 */
function getMeasurementSource(attrib: number): MeasurementMetadata['source'] {
  switch (attrib) {
    case 1:
      return 'manual';
    case 2:
      return 'auto';
    case 4:
      return 'creation';
    case 7:
      return 'confirmed';
    default:
      return 'device';
  }
}

/**
 * Helper: Extract metadata from measure group
 */
function extractMetadata(group: WithingsMeasureGroup): MeasurementMetadata {
  return {
    measuredAt: new Date(group.date * 1000).toISOString(),
    createdAt: new Date(group.created * 1000).toISOString(),
    modifiedAt: new Date(group.modified * 1000).toISOString(),
    source: getMeasurementSource(group.attrib),
    deviceId: group.deviceid,
    category: group.category === 1 ? 'measurement' : 'objective',
    timezone: group.timezone,
    comment: group.comment,
  };
}

/**
 * Helper: Process raw measurement group into structured data
 */
function processMeasurementGroup(group: WithingsMeasureGroup): ProcessedMeasurement {
  const result: ProcessedMeasurement = {
    rawData: group,
  };

  const metadata = extractMetadata(group);

  // Create a map of measurements by type
  const measureMap = new Map<MeasureType, WithingsMeasurement>();
  group.measures.forEach((m) => measureMap.set(m.type, m));

  // Weight
  const weight = measureMap.get(MeasureType.Weight);
  if (weight) {
    const kg = convertValue(weight.value, weight.unit);
    result.weight = {
      kg,
      lbs: kg * 2.20462,
      metadata,
    };
  }

  // Body fat
  const fatRatio = measureMap.get(MeasureType.FatRatio);
  const fatMass = measureMap.get(MeasureType.FatMassWeight);
  if (fatRatio || fatMass) {
    const percentage = fatRatio ? convertValue(fatRatio.value, fatRatio.unit) : undefined;
    const massKg = fatMass ? convertValue(fatMass.value, fatMass.unit) : undefined;

    result.bodyFat = {
      percentage: percentage || 0,
      massKg: massKg || 0,
      massLbs: massKg ? massKg * 2.20462 : 0,
      metadata,
    };
  }

  // Muscle mass
  const muscleMass = measureMap.get(MeasureType.MuscleMass);
  if (muscleMass) {
    const kg = convertValue(muscleMass.value, muscleMass.unit);
    result.muscleMass = {
      kg,
      lbs: kg * 2.20462,
      percentage: weight ? (kg / convertValue(weight.value, weight.unit)) * 100 : undefined,
      metadata,
    };
  }

  // Bone mass
  const boneMass = measureMap.get(MeasureType.BoneMass);
  if (boneMass) {
    const kg = convertValue(boneMass.value, boneMass.unit);
    result.boneMass = {
      kg,
      lbs: kg * 2.20462,
      metadata,
    };
  }

  // Hydration
  const hydration = measureMap.get(MeasureType.Hydration);
  if (hydration) {
    result.hydration = {
      percentage: convertValue(hydration.value, hydration.unit),
      metadata,
    };
  }

  // Visceral fat
  const visceralFat = measureMap.get(MeasureType.VisceralFat);
  if (visceralFat) {
    result.visceralFat = {
      rating: convertValue(visceralFat.value, visceralFat.unit),
      metadata,
    };
  }

  // Calculate BMI if we have weight and height
  const height = measureMap.get(MeasureType.Height);
  if (weight && height) {
    const weightKg = convertValue(weight.value, weight.unit);
    const heightM = convertValue(height.value, height.unit);
    result.bmi = weightKg / (heightM * heightM);
  }

  // Heart rate
  const heartRate = measureMap.get(MeasureType.HeartRate);
  if (heartRate) {
    result.heartRate = {
      bpm: convertValue(heartRate.value, heartRate.unit),
      metadata,
    };
  }

  // Blood pressure
  const systolic = measureMap.get(MeasureType.SystolicBloodPressure);
  const diastolic = measureMap.get(MeasureType.DiastolicBloodPressure);
  if (systolic && diastolic) {
    result.bloodPressure = {
      systolic: convertValue(systolic.value, systolic.unit),
      diastolic: convertValue(diastolic.value, diastolic.unit),
      metadata,
    };
  }

  // Temperature
  const temperature = measureMap.get(MeasureType.BodyTemperature);
  if (temperature) {
    const celsius = convertValue(temperature.value, temperature.unit);
    result.temperature = {
      celsius,
      fahrenheit: (celsius * 9) / 5 + 32,
      metadata,
    };
  }

  // SpO2
  const spo2 = measureMap.get(MeasureType.SpO2);
  if (spo2) {
    result.spo2 = {
      percentage: convertValue(spo2.value, spo2.unit),
      metadata,
    };
  }

  // Metabolic age
  const metabolicAge = measureMap.get(MeasureType.MetabolicAge);
  if (metabolicAge) {
    result.metabolicAge = {
      years: convertValue(metabolicAge.value, metabolicAge.unit),
      metadata,
    };
  }

  return result;
}

/**
 * GET /withings/measurements
 * Get latest measurements from Withings scale
 */
router.get(
  '/measurements',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info('Fetching Withings measurements');

    // Check authentication
    const isAuthenticated = await withingsAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/withings/start to connect your Withings account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      // Get measurements (default: last 30 days, most recent first)
      const limit = parseInt(req.query.limit as string) || 10;
      const startDate = req.query.startdate
        ? parseInt(req.query.startdate as string)
        : Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60; // 30 days ago
      const endDate = req.query.enddate
        ? parseInt(req.query.enddate as string)
        : Math.floor(Date.now() / 1000);

      const measureData = await withingsAuth.makeApiRequest<WithingsMeasureResponse>(
        'getmeas',
        {
          startdate: startDate,
          enddate: endDate,
          limit,
          offset: 0,
        }
      );

      logger.info(
        { count: measureData.measuregrps?.length || 0 },
        'Retrieved measurements from Withings'
      );

      // Process all measurement groups
      const processedMeasurements = (measureData.measuregrps || []).map(processMeasurementGroup);

      // Extract the latest measurement as primary data
      const latest = processedMeasurements[0];

      const response: SuccessResponse<{
        latest: ProcessedMeasurement | undefined;
        history: ProcessedMeasurement[];
        metadata: {
          lastUpdate: string;
          timezone: string;
          totalRecords: number;
          hasMore: boolean;
        };
      }> = {
        success: true,
        data: {
          latest,
          history: processedMeasurements,
          metadata: {
            lastUpdate: new Date(measureData.updatetime * 1000).toISOString(),
            timezone: measureData.timezone,
            totalRecords: measureData.measuregrps?.length || 0,
            hasMore: measureData.more === 1,
          },
        },
      };

      res.json(response);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch Withings measurements');

      if (error.message.includes('authenticate')) {
        throw new AppError(
          401,
          'Withings authentication expired. Please re-authenticate via /auth/withings/start',
          'TOKEN_EXPIRED'
        );
      }

      throw new AppError(
        500,
        `Failed to fetch Withings measurements: ${error.message}`,
        'WITHINGS_API_ERROR'
      );
    }
  })
);

/**
 * GET /withings/latest
 * Get just the latest measurement (simplified response for Coach Vic)
 */
router.get(
  '/latest',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Fetching latest Withings measurement');

    const isAuthenticated = await withingsAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/withings/start to connect your Withings account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      const measureData = await withingsAuth.makeApiRequest<WithingsMeasureResponse>(
        'getmeas',
        {
          limit: 1,
          offset: 0,
        }
      );

      if (!measureData.measuregrps || measureData.measuregrps.length === 0) {
        throw new AppError(404, 'No Withings measurements found', 'NO_DATA');
      }

      const latest = processMeasurementGroup(measureData.measuregrps[0]);

      const response: SuccessResponse<{
        measurement: ProcessedMeasurement;
        apiMetadata: {
          lastUpdate: string;
          timezone: string;
        };
      }> = {
        success: true,
        data: {
          measurement: latest,
          apiMetadata: {
            lastUpdate: new Date(measureData.updatetime * 1000).toISOString(),
            timezone: measureData.timezone,
          },
        },
      };

      res.json(response);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch latest Withings measurement');

      if (error.message.includes('authenticate')) {
        throw new AppError(
          401,
          'Withings authentication expired. Please re-authenticate via /auth/withings/start',
          'TOKEN_EXPIRED'
        );
      }

      throw new AppError(
        500,
        `Failed to fetch latest Withings measurement: ${error.message}`,
        'WITHINGS_API_ERROR'
      );
    }
  })
);

/**
 * GET /withings/weight-history
 * Get weight history over time (convenience endpoint)
 */
router.get(
  '/weight-history',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info('Fetching Withings weight history');

    const isAuthenticated = await withingsAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/withings/start to connect your Withings account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      const days = parseInt(req.query.days as string) || 90;
      const startDate = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

      const measureData = await withingsAuth.makeApiRequest<WithingsMeasureResponse>(
        'getmeas',
        {
          startdate: startDate,
          meastype: MeasureType.Weight, // Filter for weight only
        }
      );

      const weightHistory = (measureData.measuregrps || [])
        .map((group) => {
          const weight = group.measures.find((m) => m.type === MeasureType.Weight);
          if (!weight) return null;

          const kg = convertValue(weight.value, weight.unit);
          return {
            date: new Date(group.date * 1000).toISOString(),
            weight: {
              kg,
              lbs: kg * 2.20462,
            },
            metadata: extractMetadata(group),
          };
        })
        .filter((item) => item !== null);

      const response: SuccessResponse<typeof weightHistory> = {
        success: true,
        data: weightHistory,
      };

      res.json(response);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch Withings weight history');
      throw new AppError(
        500,
        `Failed to fetch Withings weight history: ${error.message}`,
        'WITHINGS_API_ERROR'
      );
    }
  })
);

/**
 * GET /withings/summary
 * Simplified endpoint for Coach Vic - flat structure, easy to parse
 */
router.get(
  '/summary',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Fetching Withings summary for Coach Vic');

    const isAuthenticated = await withingsAuth.isAuthenticated();
    if (!isAuthenticated) {
      throw new AppError(
        401,
        'Not authenticated. Please visit /auth/withings/start to connect your Withings account.',
        'NOT_AUTHENTICATED'
      );
    }

    try {
      // Fetch more measurements to find body comp data (Withings splits data across groups)
      const measureData = await withingsAuth.makeApiRequest<WithingsMeasureResponse>(
        'getmeas',
        {
          limit: 50, // Get more measurements to find body comp
          offset: 0,
        }
      );

      if (!measureData.measuregrps || measureData.measuregrps.length === 0) {
        throw new AppError(404, 'No Withings measurements found', 'NO_DATA');
      }

      // Process all groups and merge data from most recent of each type
      const allMeasurements = measureData.measuregrps.map(processMeasurementGroup);

      // Find most recent weight
      const latestWeight = allMeasurements.find(m => m.weight);

      // Find most recent body composition (any group with body fat, muscle, etc.)
      const latestBodyComp = allMeasurements.find(
        m => m.bodyFat || m.muscleMass || m.boneMass || m.hydration || m.visceralFat
      );

      // Merge the data
      const latest = {
        ...latestWeight,
        bodyFat: latestBodyComp?.bodyFat,
        muscleMass: latestBodyComp?.muscleMass,
        boneMass: latestBodyComp?.boneMass,
        hydration: latestBodyComp?.hydration,
        visceralFat: latestBodyComp?.visceralFat,
        bmi: latestWeight?.bmi || latestBodyComp?.bmi,
      } as ProcessedMeasurement;
      const measuredAt = latest.weight?.metadata.measuredAt || new Date(latest.rawData.date * 1000).toISOString();
      const measuredDate = new Date(measuredAt);
      const hoursAgo = Math.floor((Date.now() - measuredDate.getTime()) / (1000 * 60 * 60));

      // Convert to Eastern Time
      const easternTime = measuredDate.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      // Flatten structure for easy LLM parsing
      const summary = {
        // Weight data (always available)
        weightLbs: latest.weight?.lbs || null,
        weightKg: latest.weight?.kg || null,

        // Body composition (if available)
        bodyFatPercent: latest.bodyFat?.percentage || null,
        bodyFatLbs: latest.bodyFat?.massLbs || null,
        muscleMassLbs: latest.muscleMass?.lbs || null,
        muscleMassPercent: latest.muscleMass?.percentage || null,
        boneMassLbs: latest.boneMass?.lbs || null,
        hydrationPercent: latest.hydration?.percentage || null,
        visceralFatRating: latest.visceralFat?.rating || null,
        bmi: latest.bmi || null,

        // Vitals (if available)
        heartRateBpm: latest.heartRate?.bpm || null,
        bloodPressureSystolic: latest.bloodPressure?.systolic || null,
        bloodPressureDiastolic: latest.bloodPressure?.diastolic || null,
        spo2Percent: latest.spo2?.percentage || null,
        temperatureFahrenheit: latest.temperature?.fahrenheit || null,

        // Metadata
        measuredAt: measuredAt,
        measuredAtEastern: easternTime,
        hoursAgo: hoursAgo,
        source: latest.weight?.metadata.source || 'unknown',
        originalTimezone: latest.weight?.metadata.timezone || measureData.timezone,

        // Human readable summary
        summary: generateSummary(latest, hoursAgo),
      };

      const response: SuccessResponse<typeof summary> = {
        success: true,
        data: summary,
      };

      res.json(response);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch Withings summary');

      if (error.message.includes('authenticate')) {
        throw new AppError(
          401,
          'Withings authentication expired. Please re-authenticate via /auth/withings/start',
          'TOKEN_EXPIRED'
        );
      }

      throw new AppError(
        500,
        `Failed to fetch Withings summary: ${error.message}`,
        'WITHINGS_API_ERROR'
      );
    }
  })
);

/**
 * Helper: Generate human-readable summary for Coach Vic
 */
function generateSummary(measurement: ProcessedMeasurement, hoursAgo: number): string {
  const parts: string[] = [];

  // Weight
  if (measurement.weight) {
    parts.push(`Weight: ${measurement.weight.lbs.toFixed(1)} lbs (${measurement.weight.kg.toFixed(1)} kg)`);
  }

  // Body composition
  if (measurement.bodyFat) {
    parts.push(`Body Fat: ${measurement.bodyFat.percentage.toFixed(1)}%`);
  }
  if (measurement.muscleMass) {
    parts.push(`Muscle: ${measurement.muscleMass.lbs.toFixed(1)} lbs`);
  }

  // Timing
  const timeStr = hoursAgo < 1
    ? 'less than an hour ago'
    : hoursAgo === 1
    ? '1 hour ago'
    : hoursAgo < 24
    ? `${hoursAgo} hours ago`
    : `${Math.floor(hoursAgo / 24)} days ago`;

  parts.push(`Measured: ${timeStr}`);

  return parts.join(', ');
}

export default router;
