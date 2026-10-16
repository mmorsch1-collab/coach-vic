import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Typed client for the Bridge API (the OAuth/data layer). Every endpoint returns
 * `{ success, data }` or `{ success:false, error }`; this unwraps to `data` or throws.
 */

export interface WhoopToday {
  date: string;
  recovery: {
    score: number | null;
    hrv: number | null;
    restingHeartRate: number | null;
    spo2?: number | null;
    skinTemp?: number | null;
    metadata?: { created_at?: string; updated_at?: string; score_state?: string };
  };
  sleep: { durationHours: number; sleepScore?: number; inBedHours?: number };
  strain: { score: number };
  recommendation?: string;
}

export interface WithingsLatest {
  weight?: number;
  bodyFat?: number;
  muscleMass?: number;
  boneMass?: number;
  hydration?: number;
  measureDate?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  isAllDay: boolean;
}
export interface TodayCalendar {
  date: string;
  events: CalendarEvent[];
  summary: { totalEvents: number; totalMinutes: number; firstEventTime?: string; lastEventTime?: string };
}

export interface WorkoutExercise {
  name: string;
  sets: number; // integer 1..20 (required by the Bridge)
  targetReps?: number; // integer
  targetWeight?: string; // free text, e.g. "45 lb" or "BW"
  notes?: string;
}

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export class BridgeClient {
  constructor(private readonly baseUrl: string = config.bridgeUrl) {}

  private async request<T>(method: string, pathName: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${pathName}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err: any) {
      throw new BridgeError(`Bridge unreachable: ${err.message}`, 'BRIDGE_UNREACHABLE');
    }

    let json: any = {};
    try {
      json = await res.json();
    } catch {
      /* some endpoints may return empty */
    }

    if (!res.ok || json?.success === false) {
      const code = json?.error?.code || `HTTP_${res.status}`;
      const msg = json?.error?.message || `Bridge ${method} ${pathName} failed (${res.status})`;
      throw new BridgeError(msg, code, res.status);
    }
    return (json?.data ?? json) as T;
  }

  // ---- WHOOP ----
  whoopToday() {
    return this.request<WhoopToday>('GET', '/whoop/today');
  }
  whoopSnapshot(snapshot: Record<string, unknown>) {
    return this.request('POST', '/coaching/whoop-snapshot', snapshot);
  }
  /** Backfill helper: SCORED WHOOP rows over a date range, joined recovery+cycle+sleep. */
  whoopHistoryRange(start: string, end: string) {
    return this.request<Array<{
      date: string; recovery: number | null; hrv: number | null; restingHeartRate: number | null;
      sleepHours: number | null; sleepScore: number | null; strain: number | null; skinTemp: number | null;
      createdAt?: string | null; cycleEnd?: string | null; final?: boolean;
    }>>('GET', `/whoop/history-range?start=${start}&end=${end}`);
  }
  whoopHistory(days = 7) {
    return this.request<unknown[]>('GET', `/coaching/whoop-history?days=${days}`);
  }

  // ---- Withings ----
  withingsLatest() {
    return this.request<WithingsLatest>('GET', '/withings/latest');
  }
  // Flat, LLM-friendly body-comp (scans groups to merge weight + body comp).
  withingsSummary() {
    return this.request<Record<string, unknown>>('GET', '/withings/summary');
  }
  withingsHistory(days = 7) {
    return this.request<unknown>('GET', `/withings/weight-history?days=${days}`);
  }

  // ---- Strava ----
  stravaLatest() {
    return this.request<unknown>('GET', '/strava/latest');
  }

  // ---- Calendar ----
  calendarToday() {
    return this.request<TodayCalendar>('GET', '/calendar/today');
  }
  createCalendarEvent(ev: {
    title: string;
    startTime: string;
    endTime: string;
    description?: string;
    location?: string;
    timeZone?: string;
  }) {
    return this.request<{ id: string; link: string }>('POST', '/calendar/events', ev);
  }
  updateCalendarEvent(
    id: string,
    fields: {
      title?: string;
      startTime?: string;
      endTime?: string;
      description?: string;
      location?: string;
      timeZone?: string;
    },
  ) {
    return this.request<{ message: string }>('PUT', `/calendar/events/${encodeURIComponent(id)}`, fields);
  }
  deleteCalendarEvent(id: string) {
    return this.request<{ message: string }>('DELETE', `/calendar/events/${encodeURIComponent(id)}`);
  }

  // ---- Coaching / Sheets ----
  createWorkout(payload: {
    date: string;
    title: string;
    recovery?: string; // Bridge expects a string (e.g. "73% (green)")
    exercises: WorkoutExercise[];
  }) {
    return this.request<{ url: string; message: string }>('POST', '/coaching/workout', payload);
  }
  getWorkout(date: string) {
    return this.request<unknown>('GET', `/coaching/workout/${date}`);
  }
  getGoals() {
    return this.request<unknown[]>('GET', '/coaching/goals');
  }
  // ---- Generic sheet ops (read/edit any tab in the canonical workbook) ----
  listSheets() {
    return this.request<Array<{ title: string; sheetId?: number }>>('GET', '/coaching/sheets');
  }
  createSheet(title: string) {
    return this.request<{ title: string }>('POST', '/coaching/sheets', { title });
  }
  readSheet(title: string, range?: string) {
    const q = range ? `?range=${encodeURIComponent(range)}` : '';
    return this.request<unknown[][]>('GET', `/coaching/sheets/${encodeURIComponent(title)}/data${q}`);
  }
  updateSheetRange(title: string, range: string, data: unknown[][]) {
    return this.request<{ message: string }>(
      'PUT',
      `/coaching/sheets/${encodeURIComponent(title)}/range`,
      { range, data },
    );
  }
  appendSheet(title: string, data: unknown[][]) {
    return this.request<{ message: string }>(
      'POST',
      `/coaching/sheets/${encodeURIComponent(title)}/append`,
      { data },
    );
  }
  health() {
    return this.request<{ ok: boolean }>('GET', '/health');
  }
}

export const bridge = new BridgeClient();

/** Convenience: does this look like an auth/“not connected” failure? */
export function isAuthError(err: unknown): boolean {
  return (
    err instanceof BridgeError &&
    (err.code === 'NOT_AUTHENTICATED' || err.code === 'TOKEN_EXPIRED' || err.status === 401)
  );
}

logger.debug({ baseUrl: config.bridgeUrl }, 'Bridge client initialized');
