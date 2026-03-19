import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireGoogleAuth } from '../middleware/requireAuth.js';
import { SuccessResponse } from '../types.js';
import { googleSheets, Goal, Task, WhoopSnapshot, WorkoutSheetData, SheetInfo } from '../services/googleSheets.js';
import { logger } from '../logger.js';
import {
  createGoalSchema,
  updateGoalProgressSchema,
  createTaskSchema,
  updateTaskStatusSchema,
  whoopSnapshotSchema,
  taskStatusQuerySchema,
  whoopHistoryQuerySchema,
  createWorkoutSchema,
} from '../validation/schemas.js';

const router = Router();

// PERFORMANCE: Apply authentication middleware to all routes
// This runs once per request instead of checking auth in every endpoint
router.use(requireGoogleAuth);

// ========== GOALS ==========

/**
 * GET /coaching/goals
 * Get all goals
 */
router.get(
  '/goals',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Fetching goals');

    const goals = await googleSheets.getGoals();

    const response: SuccessResponse<Goal[]> = {
      success: true,
      data: goals,
    };

    res.json(response);
  })
);

/**
 * POST /coaching/goals
 * Add a new goal
 * Body: { name, target, current?, frequency?, category?, active? }
 */
router.post(
  '/goals',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info({ body: req.body }, 'Adding new goal');

    // Validate input
    const validatedData = createGoalSchema.parse(req.body);

    const newGoal = await googleSheets.addGoal(validatedData);

    const response: SuccessResponse<Goal> = {
      success: true,
      data: newGoal,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /coaching/goals/:id/progress
 * Update goal progress
 * Body: { current }
 */
router.put(
  '/goals/:id/progress',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    logger.info({ goalId: id, body: req.body }, 'Updating goal progress');

    // Validate input
    const { current } = updateGoalProgressSchema.parse(req.body);

    await googleSheets.updateGoalProgress(id, current as number);

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: { message: 'Goal progress updated successfully' },
    };

    res.json(response);
  })
);

// ========== TASKS ==========

/**
 * GET /coaching/tasks
 * Get all tasks (optionally filter by status)
 * Query params: ?status=pending|in_progress|completed
 */
router.get(
  '/tasks',
  asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.query;
    logger.info({ status }, 'Fetching tasks');

    // Validate query parameter
    const validStatus = taskStatusQuerySchema.parse(status);
    const tasks = await googleSheets.getTasks(validStatus);

    const response: SuccessResponse<Task[]> = {
      success: true,
      data: tasks,
    };

    res.json(response);
  })
);

/**
 * POST /coaching/tasks
 * Add a new task
 * Body: { title, description?, status?, priority?, dueDate? }
 */
router.post(
  '/tasks',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info({ body: req.body }, 'Adding new task');

    // Validate input
    const validatedData = createTaskSchema.parse(req.body);

    const newTask = await googleSheets.addTask(validatedData);

    const response: SuccessResponse<Task> = {
      success: true,
      data: newTask,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /coaching/tasks/:id/status
 * Update task status
 * Body: { status }
 */
router.put(
  '/tasks/:id/status',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    logger.info({ taskId: id, body: req.body }, 'Updating task status');

    // Validate input
    const { status } = updateTaskStatusSchema.parse(req.body);

    await googleSheets.updateTaskStatus(id, status);

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: { message: 'Task status updated successfully' },
    };

    res.json(response);
  })
);

// ========== WHOOP HISTORY ==========

/**
 * GET /coaching/whoop-history
 * Get recent WHOOP history
 * Query params: ?days=7 (default 7)
 */
router.get(
  '/whoop-history',
  asyncHandler(async (req: Request, res: Response) => {
    // Validate query parameters
    const { days } = whoopHistoryQuerySchema.parse(req.query);
    logger.info({ days }, 'Fetching WHOOP history');

    const history = await googleSheets.getWhoopHistory(days);

    const response: SuccessResponse<WhoopSnapshot[]> = {
      success: true,
      data: history,
    };

    res.json(response);
  })
);

/**
 * POST /coaching/whoop-snapshot
 * Record a WHOOP data snapshot
 * Body: WhoopSnapshot
 */
router.post(
  '/whoop-snapshot',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info({ body: req.body }, 'Recording WHOOP snapshot');

    // Validate input
    const snapshot = whoopSnapshotSchema.parse(req.body);

    await googleSheets.recordWhoopSnapshot(snapshot);

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: { message: 'WHOOP snapshot recorded successfully' },
    };

    res.status(201).json(response);
  })
);

// ========== WORKOUTS ==========

/**
 * POST /coaching/workout
 * Create a new workout sheet tab
 * Body: { date, title, recovery?, exercises: WorkoutExercise[] }
 */
router.post(
  '/workout',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info({ body: req.body }, 'Creating workout sheet');

    const { date, title, recovery, exercises } = createWorkoutSchema.parse(req.body);
    const url = await googleSheets.createWorkoutSheet(date, title, exercises, recovery);

    const response: SuccessResponse<{ url: string; message: string }> = {
      success: true,
      data: { url, message: `Workout sheet created for ${date}` },
    };

    res.status(201).json(response);
  })
);

/**
 * GET /coaching/workout/:date
 * Get workout data for a specific date
 */
router.get(
  '/workout/:date',
  asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.params;
    logger.info({ date }, 'Fetching workout sheet');

    const workout = await googleSheets.getWorkoutSheet(date);

    const response: SuccessResponse<WorkoutSheetData> = {
      success: true,
      data: workout,
    };

    res.json(response);
  })
);

/**
 * DELETE /coaching/workout/:date
 * Delete a workout sheet tab
 */
router.delete(
  '/workout/:date',
  asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.params;
    logger.info({ date }, 'Deleting workout sheet');

    await googleSheets.deleteWorkoutSheet(date);

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: { message: `Workout sheet for ${date} deleted successfully` },
    };

    res.json(response);
  })
);

// ========== GENERIC SHEET OPERATIONS ==========

/**
 * GET /coaching/sheets
 * List all sheets/tabs in the spreadsheet
 */
router.get(
  '/sheets',
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Listing all sheets');

    const sheets = await googleSheets.listSheets();

    const response: SuccessResponse<SheetInfo[]> = {
      success: true,
      data: sheets,
    };

    res.json(response);
  })
);

/**
 * POST /coaching/sheets
 * Create a new sheet/tab
 * Body: { title }
 */
router.post(
  '/sheets',
  asyncHandler(async (req: Request, res: Response) => {
    const { title } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({
        success: false,
        error: { message: 'Sheet title is required', code: 'INVALID_INPUT' },
      });
    }

    logger.info({ title }, 'Creating new sheet');

    const sheet = await googleSheets.createSheet(title);

    const response: SuccessResponse<SheetInfo> = {
      success: true,
      data: sheet,
    };

    return res.status(201).json(response);
  })
);

/**
 * DELETE /coaching/sheets/:title
 * Delete a sheet/tab
 */
router.delete(
  '/sheets/:title',
  asyncHandler(async (req: Request, res: Response) => {
    const { title } = req.params;
    logger.info({ title }, 'Deleting sheet');

    await googleSheets.deleteSheet(title);

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: { message: `Sheet "${title}" deleted successfully` },
    };

    res.json(response);
  })
);

/**
 * GET /coaching/sheets/:title/data
 * Read data from a sheet/tab
 * Query params: ?range=A1:D10 (optional)
 */
router.get(
  '/sheets/:title/data',
  asyncHandler(async (req: Request, res: Response) => {
    const { title } = req.params;
    const { range } = req.query;

    logger.info({ title, range }, 'Reading sheet data');

    const data = await googleSheets.readSheetData(title, range as string | undefined);

    const response: SuccessResponse<any[][]> = {
      success: true,
      data,
    };

    res.json(response);
  })
);

/**
 * PUT /coaching/sheets/:title/data
 * Write/update data to a sheet/tab (replaces existing data)
 * Body: { data: [][], range?: string }
 */
router.put(
  '/sheets/:title/data',
  asyncHandler(async (req: Request, res: Response) => {
    const { title } = req.params;
    const { data, range } = req.body;

    if (!Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Data must be a 2D array', code: 'INVALID_INPUT' },
      });
    }

    logger.info({ title, range, rowCount: data.length }, 'Writing sheet data');

    await googleSheets.writeSheetData(title, data, range);

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: { message: `Data written to sheet "${title}" successfully` },
    };

    return res.json(response);
  })
);

/**
 * POST /coaching/sheets/:title/append
 * Append rows to a sheet/tab
 * Body: { data: [][] }
 */
router.post(
  '/sheets/:title/append',
  asyncHandler(async (req: Request, res: Response) => {
    const { title } = req.params;
    const { data } = req.body;

    if (!Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Data must be a 2D array', code: 'INVALID_INPUT' },
      });
    }

    logger.info({ title, rowCount: data.length }, 'Appending to sheet');

    await googleSheets.appendSheetData(title, data);

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: { message: `${data.length} rows appended to sheet "${title}" successfully` },
    };

    return res.status(201).json(response);
  })
);

/**
 * PUT /coaching/sheets/:title/range
 * Update a specific cell or range in a sheet
 * Body: { range: string, data: [][] }
 */
router.put(
  '/sheets/:title/range',
  asyncHandler(async (req: Request, res: Response) => {
    const { title } = req.params;
    const { range, data } = req.body;

    if (!range || typeof range !== 'string') {
      return res.status(400).json({
        success: false,
        error: { message: 'Range is required', code: 'INVALID_INPUT' },
      });
    }

    if (!Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Data must be a 2D array', code: 'INVALID_INPUT' },
      });
    }

    logger.info({ title, range }, 'Updating cell range');

    await googleSheets.updateCellRange(title, range, data);

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: { message: `Range ${range} in sheet "${title}" updated successfully` },
    };

    return res.json(response);
  })
);

/**
 * DELETE /coaching/sheets/:title/data
 * Clear all data from a sheet/tab (preserves the tab)
 * Query params: ?range=A1:D10 (optional)
 */
router.delete(
  '/sheets/:title/data',
  asyncHandler(async (req: Request, res: Response) => {
    const { title } = req.params;
    const { range } = req.query;

    logger.info({ title, range }, 'Clearing sheet data');

    await googleSheets.clearSheetData(title, range as string | undefined);

    const response: SuccessResponse<{ message: string }> = {
      success: true,
      data: { message: `Data cleared from sheet "${title}" successfully` },
    };

    res.json(response);
  })
);

export default router;
