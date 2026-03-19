import { google, sheets_v4 } from 'googleapis';
import { googleAuth } from './googleAuth.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

/**
 * Simple cache utility for response caching
 */
class SimpleCache<T> {
  private cache = new Map<string, { data: T; expiry: number }>();

  get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item || Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }

  set(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, { data, expiry: Date.now() + ttlMs });
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Google Sheets service
 * Handles reading and writing to the coaching database spreadsheet
 *
 * PERFORMANCE OPTIMIZATIONS:
 * - Caches Google Sheets API client (avoids re-auth on every request)
 * - Caches read responses for 30 seconds (reduces API calls)
 */
export class GoogleSheetsService {
  private readonly SPREADSHEET_ID = config.google.sheetId;

  // Sheet names (tabs)
  private readonly SHEETS = {
    GOALS: 'Goals',
    WHOOP_HISTORY: 'WHOOP_History',
    TASKS: 'Tasks',
  };

  // Client caching
  private sheetsClient: sheets_v4.Sheets | null = null;
  private clientExpiry: number = 0;

  // Response caching
  private goalsCache = new SimpleCache<Goal[]>();
  private tasksCache = new SimpleCache<Task[]>();
  private whoopCache = new SimpleCache<WhoopSnapshot[]>();

  /**
   * Get authenticated Sheets client (with caching)
   */
  private async getSheetsClient(): Promise<sheets_v4.Sheets> {
    // Return cached client if still valid
    if (this.sheetsClient && Date.now() < this.clientExpiry) {
      return this.sheetsClient;
    }

    const auth = await googleAuth.getAuthenticatedClient();
    this.sheetsClient = google.sheets({ version: 'v4', auth });
    this.clientExpiry = Date.now() + 3600000; // 1 hour

    return this.sheetsClient;
  }

  // ========== GOALS ==========

  /**
   * Get all goals from the Goals sheet (with caching)
   * Expected columns: ID, Name, Target, Current, Frequency, Category, Active
   */
  async getGoals(): Promise<Goal[]> {
    // Check cache first
    const cached = this.goalsCache.get('goals');
    if (cached) {
      logger.debug('Returning cached goals');
      return cached;
    }

    try {
      const sheets = await this.getSheetsClient();
      const range = `${this.SHEETS.GOALS}!A2:G`; // Skip header row

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range,
      });

      const rows = response.data.values || [];
      const goals = rows.map((row) => ({
        id: row[0] || '',
        name: row[1] || '',
        target: parseFloat(row[2]) || 0,
        current: parseFloat(row[3]) || 0,
        frequency: row[4] || 'weekly',
        category: row[5] || 'general',
        active: row[6]?.toLowerCase() === 'true',
      }));

      // Cache for 30 seconds
      this.goalsCache.set('goals', goals, 30000);
      logger.info({ rowCount: rows.length }, 'Retrieved goals from sheet and cached');

      return goals;
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to get goals from sheet');
      throw new Error(`Failed to get goals: ${error.message}`);
    }
  }

  /**
   * Update goal progress
   */
  async updateGoalProgress(goalId: string, newCurrent: number): Promise<void> {
    try {
      const sheets = await this.getSheetsClient();
      const goals = await this.getGoals();

      const goalIndex = goals.findIndex((g) => g.id === goalId);
      if (goalIndex === -1) {
        throw new Error(`Goal with ID ${goalId} not found`);
      }

      // Update the "Current" column (column D, index 3)
      const rowNumber = goalIndex + 2; // +2 because row 1 is header and array is 0-indexed
      const range = `${this.SHEETS.GOALS}!D${rowNumber}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[newCurrent]],
        },
      });

      // Invalidate cache after update
      this.goalsCache.clear();

      logger.info({ goalId, newCurrent }, 'Updated goal progress and cleared cache');
    } catch (error: any) {
      logger.error({ err: error, goalId }, 'Failed to update goal progress');
      throw new Error(`Failed to update goal progress: ${error.message}`);
    }
  }

  /**
   * Add a new goal
   */
  async addGoal(goal: Omit<Goal, 'id'>): Promise<Goal> {
    try {
      const sheets = await this.getSheetsClient();

      // Generate simple ID (timestamp-based)
      const id = `goal_${Date.now()}`;
      const newGoal: Goal = { id, ...goal };

      const range = `${this.SHEETS.GOALS}!A:G`;
      await sheets.spreadsheets.values.append({
        spreadsheetId: this.SPREADSHEET_ID,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            newGoal.id,
            newGoal.name,
            newGoal.target,
            newGoal.current,
            newGoal.frequency,
            newGoal.category,
            newGoal.active,
          ]],
        },
      });

      // Invalidate cache after adding
      this.goalsCache.clear();

      logger.info({ goal: newGoal }, 'Added new goal to sheet and cleared cache');
      return newGoal;
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to add goal');
      throw new Error(`Failed to add goal: ${error.message}`);
    }
  }

  // ========== WHOOP HISTORY ==========

  /**
   * Record WHOOP data snapshot
   * Expected columns: Date, Recovery, HRV, Resting HR, Sleep Hours, Sleep Score, Strain, Skin Temp
   */
  async recordWhoopSnapshot(data: WhoopSnapshot): Promise<void> {
    try {
      const sheets = await this.getSheetsClient();
      const range = `${this.SHEETS.WHOOP_HISTORY}!A:H`;

      await sheets.spreadsheets.values.append({
        spreadsheetId: this.SPREADSHEET_ID,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            data.date,
            data.recovery,
            data.hrv,
            data.restingHeartRate,
            data.sleepHours,
            data.sleepScore,
            data.strain,
            data.skinTemp,
          ]],
        },
      });

      // Invalidate cache after recording
      this.whoopCache.clear();

      logger.info({ date: data.date }, 'Recorded WHOOP snapshot to sheet and cleared cache');
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to record WHOOP snapshot');
      throw new Error(`Failed to record WHOOP snapshot: ${error.message}`);
    }
  }

  /**
   * Get recent WHOOP history (last N days) (with caching)
   */
  async getWhoopHistory(days: number = 7): Promise<WhoopSnapshot[]> {
    const cacheKey = `whoop_${days}`;
    const cached = this.whoopCache.get(cacheKey);
    if (cached) {
      logger.debug({ cacheKey }, 'Returning cached WHOOP history');
      return cached;
    }

    try {
      const sheets = await this.getSheetsClient();
      const range = `${this.SHEETS.WHOOP_HISTORY}!A2:H`; // Skip header

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range,
      });

      const rows = response.data.values || [];

      // Convert rows to WhoopSnapshot objects
      const snapshots = rows.map((row) => ({
        date: row[0] || '',
        recovery: parseFloat(row[1]) || null,
        hrv: parseFloat(row[2]) || null,
        restingHeartRate: parseFloat(row[3]) || null,
        sleepHours: parseFloat(row[4]) || 0,
        sleepScore: parseFloat(row[5]) || null,
        strain: parseFloat(row[6]) || 0,
        skinTemp: parseFloat(row[7]) || null,
      }));

      // Sort by date descending and take last N days
      const sorted = snapshots
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, days);

      // Cache for 30 seconds
      this.whoopCache.set(cacheKey, sorted, 30000);
      logger.info({ days, count: sorted.length }, 'Retrieved WHOOP history from sheet and cached');

      return sorted;
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to get WHOOP history');
      throw new Error(`Failed to get WHOOP history: ${error.message}`);
    }
  }

  // ========== TASKS ==========

  /**
   * Get all tasks from the Tasks sheet (with caching)
   * Expected columns: ID, Title, Description, Status, Priority, Due Date, Created Date
   */
  async getTasks(status?: 'pending' | 'in_progress' | 'completed'): Promise<Task[]> {
    // Use cache key with status filter
    const cacheKey = status ? `tasks_${status}` : 'tasks_all';
    const cached = this.tasksCache.get(cacheKey);
    if (cached) {
      logger.debug({ cacheKey }, 'Returning cached tasks');
      return cached;
    }

    try {
      const sheets = await this.getSheetsClient();
      const range = `${this.SHEETS.TASKS}!A2:G`; // Skip header

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range,
      });

      const rows = response.data.values || [];
      const tasks = rows.map((row) => ({
        id: row[0] || '',
        title: row[1] || '',
        description: row[2] || '',
        status: (row[3] || 'pending') as 'pending' | 'in_progress' | 'completed',
        priority: (row[4] || 'medium') as 'low' | 'medium' | 'high',
        dueDate: row[5] || null,
        createdDate: row[6] || new Date().toISOString().split('T')[0],
      }));

      // Filter by status if provided
      const filtered = status ? tasks.filter((t) => t.status === status) : tasks;

      // Cache for 30 seconds
      this.tasksCache.set(cacheKey, filtered, 30000);
      logger.info({ status, count: filtered.length }, 'Retrieved tasks from sheet and cached');

      return filtered;
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to get tasks');
      throw new Error(`Failed to get tasks: ${error.message}`);
    }
  }

  /**
   * Add a new task
   */
  async addTask(task: Omit<Task, 'id' | 'createdDate'>): Promise<Task> {
    try {
      const sheets = await this.getSheetsClient();

      const id = `task_${Date.now()}`;
      const createdDate = new Date().toISOString().split('T')[0];
      const newTask: Task = { id, createdDate, ...task };

      const range = `${this.SHEETS.TASKS}!A:G`;
      await sheets.spreadsheets.values.append({
        spreadsheetId: this.SPREADSHEET_ID,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            newTask.id,
            newTask.title,
            newTask.description,
            newTask.status,
            newTask.priority,
            newTask.dueDate || '',
            newTask.createdDate,
          ]],
        },
      });

      // Invalidate cache after adding
      this.tasksCache.clear();

      logger.info({ task: newTask }, 'Added new task to sheet and cleared cache');
      return newTask;
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to add task');
      throw new Error(`Failed to add task: ${error.message}`);
    }
  }

  /**
   * Update task status
   */
  async updateTaskStatus(taskId: string, status: 'pending' | 'in_progress' | 'completed'): Promise<void> {
    try {
      const sheets = await this.getSheetsClient();
      const tasks = await this.getTasks();

      const taskIndex = tasks.findIndex((t) => t.id === taskId);
      if (taskIndex === -1) {
        throw new Error(`Task with ID ${taskId} not found`);
      }

      // Update the "Status" column (column D, index 3)
      const rowNumber = taskIndex + 2; // +2 because row 1 is header and array is 0-indexed
      const range = `${this.SHEETS.TASKS}!D${rowNumber}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[status]],
        },
      });

      // Invalidate cache after update
      this.tasksCache.clear();

      logger.info({ taskId, status }, 'Updated task status and cleared cache');
    } catch (error: any) {
      logger.error({ err: error, taskId }, 'Failed to update task status');
      throw new Error(`Failed to update task status: ${error.message}`);
    }
  }

  // ========== WORKOUTS ==========

  /**
   * Create a new workout sheet tab
   * Format matches the existing workout sheets in the spreadsheet
   */
  async createWorkoutSheet(
    date: string,
    title: string,
    exercises: WorkoutExercise[],
    recovery?: string
  ): Promise<string> {
    try {
      const sheets = await this.getSheetsClient();
      const sheetTitle = `Workout_${date}`;

      // Create the new tab and capture the response
      const createResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: sheetTitle },
              },
            },
          ],
        },
      });

      // Extract the new sheet ID from the response
      const newSheetId = createResponse.data.replies?.[0]?.addSheet?.properties?.sheetId;

      // Build all rows
      const rows: (string | number)[][] = [];

      // Row 1: Workout title
      rows.push([title]);
      // Row 2: Date and recovery
      const d = new Date(date + 'T12:00:00');
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const monthName = d.toLocaleDateString('en-US', { month: 'short' });
      const day = d.getDate();
      rows.push([`${dayName} ${monthName} ${day} | Recovery: ${recovery || 'TBD'}`]);
      // Row 3: blank
      rows.push([]);
      // Row 4: Headers
      rows.push(['Exercise', 'Set', 'Last Time', 'Weight', 'Reps', 'Done']);
      // Row 5: blank
      rows.push([]);

      // Exercise rows
      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];
        for (let s = 1; s <= ex.sets; s++) {
          rows.push([
            s === 1 ? ex.name : '',
            s,
            '-',
            ex.targetWeight || '',
            ex.targetReps || '',
            '',
          ]);
        }
        // Blank row between exercises (except after last)
        if (i < exercises.length - 1) {
          rows.push([]);
        }
      }

      // Write all data
      await sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${sheetTitle}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });

      // Bold the title row (row 1) and headers (row 4) using the captured sheet ID
      if (newSheetId != null) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.SPREADSHEET_ID,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: {
                    sheetId: newSheetId,
                    startRowIndex: 0,
                    endRowIndex: 1,
                    startColumnIndex: 0,
                    endColumnIndex: 1,
                  },
                  cell: {
                    userEnteredFormat: {
                      textFormat: { bold: true },
                    },
                  },
                  fields: 'userEnteredFormat.textFormat.bold',
                },
              },
              {
                repeatCell: {
                  range: {
                    sheetId: newSheetId,
                    startRowIndex: 3,
                    endRowIndex: 4,
                    startColumnIndex: 0,
                    endColumnIndex: 6,
                  },
                  cell: {
                    userEnteredFormat: {
                      textFormat: { bold: true },
                    },
                  },
                  fields: 'userEnteredFormat.textFormat.bold',
                },
              },
            ],
          },
        });
      }

      const url = `https://docs.google.com/spreadsheets/d/${this.SPREADSHEET_ID}/edit#gid=${newSheetId || 0}`;
      logger.info({ date, title, exerciseCount: exercises.length, sheetId: newSheetId }, 'Created workout sheet');
      return url;
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to create workout sheet');
      throw new Error(`Failed to create workout sheet: ${error.message}`);
    }
  }

  /**
   * Delete a workout sheet tab by date
   */
  async deleteWorkoutSheet(date: string): Promise<void> {
    try {
      const sheets = await this.getSheetsClient();
      const sheetTitle = `Workout_${date}`;

      // Find the sheet ID
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: this.SPREADSHEET_ID,
      });
      const sheet = spreadsheet.data.sheets?.find(
        (s) => s.properties?.title === sheetTitle
      );
      if (!sheet?.properties?.sheetId) {
        throw new Error(`Workout sheet for ${date} not found`);
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              deleteSheet: {
                sheetId: sheet.properties.sheetId,
              },
            },
          ],
        },
      });

      logger.info({ date, sheetTitle }, 'Deleted workout sheet');
    } catch (error: any) {
      logger.error({ err: error, date }, 'Failed to delete workout sheet');
      throw new Error(`Failed to delete workout sheet: ${error.message}`);
    }
  }

  // ========== GENERIC SHEET OPERATIONS ==========

  /**
   * List all sheets/tabs in the spreadsheet
   */
  async listSheets(): Promise<SheetInfo[]> {
    try {
      const sheets = await this.getSheetsClient();
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: this.SPREADSHEET_ID,
      });

      const sheetInfos = (spreadsheet.data.sheets || []).map((sheet) => ({
        title: sheet.properties?.title || '',
        sheetId: sheet.properties?.sheetId || 0,
        index: sheet.properties?.index || 0,
        rowCount: sheet.properties?.gridProperties?.rowCount || 0,
        columnCount: sheet.properties?.gridProperties?.columnCount || 0,
      }));

      logger.info({ count: sheetInfos.length }, 'Listed all sheets');
      return sheetInfos;
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to list sheets');
      throw new Error(`Failed to list sheets: ${error.message}`);
    }
  }

  /**
   * Create a new sheet/tab
   */
  async createSheet(title: string): Promise<SheetInfo> {
    try {
      const sheets = await this.getSheetsClient();

      const response = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title },
              },
            },
          ],
        },
      });

      const newSheet = response.data.replies?.[0]?.addSheet?.properties;
      if (!newSheet) {
        throw new Error('Failed to get new sheet properties');
      }

      const sheetInfo: SheetInfo = {
        title: newSheet.title || title,
        sheetId: newSheet.sheetId || 0,
        index: newSheet.index || 0,
        rowCount: newSheet.gridProperties?.rowCount || 0,
        columnCount: newSheet.gridProperties?.columnCount || 0,
      };

      logger.info({ sheetInfo }, 'Created new sheet');
      return sheetInfo;
    } catch (error: any) {
      logger.error({ err: error, title }, 'Failed to create sheet');
      throw new Error(`Failed to create sheet: ${error.message}`);
    }
  }

  /**
   * Delete a sheet/tab by title
   */
  async deleteSheet(title: string): Promise<void> {
    try {
      const sheets = await this.getSheetsClient();

      // Find the sheet ID
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: this.SPREADSHEET_ID,
      });
      const sheet = spreadsheet.data.sheets?.find(
        (s) => s.properties?.title === title
      );
      if (!sheet?.properties?.sheetId) {
        throw new Error(`Sheet "${title}" not found`);
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              deleteSheet: {
                sheetId: sheet.properties.sheetId,
              },
            },
          ],
        },
      });

      logger.info({ title }, 'Deleted sheet');
    } catch (error: any) {
      logger.error({ err: error, title }, 'Failed to delete sheet');
      throw new Error(`Failed to delete sheet: ${error.message}`);
    }
  }

  /**
   * Read data from any sheet/tab
   * Returns raw 2D array of cell values
   */
  async readSheetData(title: string, range?: string): Promise<any[][]> {
    try {
      const sheets = await this.getSheetsClient();
      const fullRange = range ? `${title}!${range}` : `${title}`;

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range: fullRange,
      });

      const data = response.data.values || [];
      logger.info({ title, range, rowCount: data.length }, 'Read sheet data');
      return data;
    } catch (error: any) {
      logger.error({ err: error, title, range }, 'Failed to read sheet data');
      throw new Error(`Failed to read sheet data: ${error.message}`);
    }
  }

  /**
   * Write/update data to a sheet/tab (replaces existing data)
   */
  async writeSheetData(title: string, data: any[][], range?: string): Promise<void> {
    try {
      const sheets = await this.getSheetsClient();
      const fullRange = range ? `${title}!${range}` : `${title}!A1`;

      await sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range: fullRange,
        valueInputOption: 'USER_ENTERED', // Allows formulas, dates, etc.
        requestBody: {
          values: data,
        },
      });

      logger.info({ title, range, rowCount: data.length }, 'Wrote sheet data');
    } catch (error: any) {
      logger.error({ err: error, title, range }, 'Failed to write sheet data');
      throw new Error(`Failed to write sheet data: ${error.message}`);
    }
  }

  /**
   * Append rows to a sheet/tab
   */
  async appendSheetData(title: string, data: any[][]): Promise<void> {
    try {
      const sheets = await this.getSheetsClient();
      const range = `${title}!A1`;

      await sheets.spreadsheets.values.append({
        spreadsheetId: this.SPREADSHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: data,
        },
      });

      logger.info({ title, rowCount: data.length }, 'Appended sheet data');
    } catch (error: any) {
      logger.error({ err: error, title }, 'Failed to append sheet data');
      throw new Error(`Failed to append sheet data: ${error.message}`);
    }
  }

  /**
   * Update a specific cell or range in a sheet
   */
  async updateCellRange(title: string, range: string, data: any[][]): Promise<void> {
    try {
      const sheets = await this.getSheetsClient();
      const fullRange = `${title}!${range}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range: fullRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: data,
        },
      });

      logger.info({ title, range }, 'Updated cell range');
    } catch (error: any) {
      logger.error({ err: error, title, range }, 'Failed to update cell range');
      throw new Error(`Failed to update cell range: ${error.message}`);
    }
  }

  /**
   * Clear all data from a sheet/tab (preserves the tab)
   */
  async clearSheetData(title: string, range?: string): Promise<void> {
    try {
      const sheets = await this.getSheetsClient();
      const fullRange = range ? `${title}!${range}` : title;

      await sheets.spreadsheets.values.clear({
        spreadsheetId: this.SPREADSHEET_ID,
        range: fullRange,
      });

      logger.info({ title, range }, 'Cleared sheet data');
    } catch (error: any) {
      logger.error({ err: error, title, range }, 'Failed to clear sheet data');
      throw new Error(`Failed to clear sheet data: ${error.message}`);
    }
  }

  /**
   * Get workout data from a sheet tab by date
   */
  async getWorkoutSheet(date: string): Promise<WorkoutSheetData> {
    try {
      const sheets = await this.getSheetsClient();
      const sheetTitle = `Workout_${date}`;
      const range = `${sheetTitle}!A1:F100`;

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range,
      });

      const rows = response.data.values || [];
      if (rows.length < 5) {
        throw new Error(`Workout sheet for ${date} has unexpected format`);
      }

      const title = rows[0]?.[0] || '';
      const dateInfo = rows[1]?.[0] || '';
      // rows[2] blank, rows[3] headers, rows[4] blank
      const exerciseRows = rows.slice(5);

      const exercises: WorkoutSheetExercise[] = [];
      let currentExercise: WorkoutSheetExercise | null = null;

      for (const row of exerciseRows) {
        // Blank row = separator between exercises
        if (!row || row.every((cell: string) => !cell || cell.trim() === '')) {
          if (currentExercise) {
            exercises.push(currentExercise);
            currentExercise = null;
          }
          continue;
        }

        const name = row[0]?.trim() || '';
        const set = parseInt(row[1]) || 0;
        const lastTime = row[2] || '';
        const weight = row[3] || '';
        const reps = row[4] || '';
        const done = row[5] || '';

        if (name) {
          // New exercise
          if (currentExercise) {
            exercises.push(currentExercise);
          }
          currentExercise = {
            name,
            sets: [{ set, lastTime, weight, reps, done }],
          };
        } else if (currentExercise && set > 0) {
          currentExercise.sets.push({ set, lastTime, weight, reps, done });
        }
      }
      if (currentExercise) {
        exercises.push(currentExercise);
      }

      logger.info({ date, exerciseCount: exercises.length }, 'Retrieved workout sheet');
      return { title, dateInfo, exercises };
    } catch (error: any) {
      logger.error({ err: error, date }, 'Failed to get workout sheet');
      throw new Error(`Failed to get workout sheet: ${error.message}`);
    }
  }
}

// Workout types
export interface WorkoutExercise {
  name: string;
  sets: number;
  targetReps?: number;
  targetWeight?: string;
  notes?: string;
}

export interface WorkoutSheetExercise {
  name: string;
  sets: {
    set: number;
    lastTime: string;
    weight: string;
    reps: string;
    done: string;
  }[];
}

export interface WorkoutSheetData {
  title: string;
  dateInfo: string;
  exercises: WorkoutSheetExercise[];
}

// Type definitions
export interface SheetInfo {
  title: string;
  sheetId: number;
  index: number;
  rowCount: number;
  columnCount: number;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  current: number;
  frequency: string; // 'daily', 'weekly', 'monthly'
  category: string; // 'fitness', 'mindfulness', 'health', etc.
  active: boolean;
}

export interface WhoopSnapshot {
  date: string; // YYYY-MM-DD
  recovery?: number | null;
  hrv?: number | null;
  restingHeartRate?: number | null;
  sleepHours: number;
  sleepScore?: number | null;
  strain: number;
  skinTemp?: number | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null; // YYYY-MM-DD
  createdDate: string; // YYYY-MM-DD
}

// Export singleton instance
export const googleSheets = new GoogleSheetsService();
