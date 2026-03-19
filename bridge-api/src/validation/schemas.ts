import { z } from 'zod';

/**
 * Validation schemas for API request bodies
 * Using Zod for runtime validation with TypeScript type inference
 */

// ========== GOAL SCHEMAS ==========

export const createGoalSchema = z.object({
  name: z
    .string()
    .min(1, 'Goal name is required')
    .max(200, 'Goal name must be less than 200 characters')
    .trim(),
  target: z
    .number()
    .positive('Target must be a positive number')
    .or(z.string().transform((val) => parseFloat(val)))
    .refine((val) => !isNaN(val as number) && val > 0, 'Target must be a positive number'),
  current: z
    .number()
    .min(0, 'Current progress cannot be negative')
    .optional()
    .default(0)
    .or(z.string().transform((val) => parseFloat(val))),
  frequency: z
    .enum(['daily', 'weekly', 'monthly'], {
      errorMap: () => ({ message: 'Frequency must be daily, weekly, or monthly' }),
    })
    .default('weekly'),
  category: z
    .string()
    .min(1, 'Category is required')
    .max(50, 'Category must be less than 50 characters')
    .trim()
    .default('general'),
  active: z.boolean().optional().default(true),
});

export const updateGoalProgressSchema = z.object({
  current: z
    .number()
    .min(0, 'Current progress cannot be negative')
    .or(z.string().transform((val) => parseFloat(val)))
    .refine((val) => !isNaN(val as number) && val >= 0, 'Current progress must be a non-negative number'),
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalProgressInput = z.infer<typeof updateGoalProgressSchema>;

// ========== TASK SCHEMAS ==========

export const createTaskSchema = z.object({
  title: z
    .string()
    .min(1, 'Task title is required')
    .max(200, 'Task title must be less than 200 characters')
    .trim(),
  description: z
    .string()
    .max(1000, 'Description must be less than 1000 characters')
    .trim()
    .optional()
    .default(''),
  status: z
    .enum(['pending', 'in_progress', 'completed'], {
      errorMap: () => ({ message: 'Status must be pending, in_progress, or completed' }),
    })
    .optional()
    .default('pending'),
  priority: z
    .enum(['low', 'medium', 'high'], {
      errorMap: () => ({ message: 'Priority must be low, medium, or high' }),
    })
    .optional()
    .default('medium'),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be in YYYY-MM-DD format')
    .optional()
    .nullable()
    .default(null),
});

export const updateTaskStatusSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed'], {
    errorMap: () => ({ message: 'Status must be pending, in_progress, or completed' }),
  }),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;

// ========== WHOOP SNAPSHOT SCHEMA ==========

export const whoopSnapshotSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  recovery: z
    .number()
    .min(0, 'Recovery must be between 0 and 100')
    .max(100, 'Recovery must be between 0 and 100')
    .nullable()
    .optional(),
  hrv: z
    .number()
    .min(0, 'HRV must be non-negative')
    .nullable()
    .optional(),
  restingHeartRate: z
    .number()
    .min(30, 'Resting heart rate must be realistic (30-120 bpm)')
    .max(120, 'Resting heart rate must be realistic (30-120 bpm)')
    .nullable()
    .optional(),
  sleepHours: z
    .number()
    .min(0, 'Sleep hours must be non-negative')
    .max(24, 'Sleep hours cannot exceed 24')
    .optional()
    .default(0),
  sleepScore: z
    .number()
    .min(0, 'Sleep score must be between 0 and 100')
    .max(100, 'Sleep score must be between 0 and 100')
    .nullable()
    .optional(),
  strain: z
    .number()
    .min(0, 'Strain must be between 0 and 21')
    .max(21, 'Strain must be between 0 and 21')
    .optional()
    .default(0),
  skinTemp: z
    .number()
    .min(90, 'Skin temp must be realistic (90-105°F)')
    .max(105, 'Skin temp must be realistic (90-105°F)')
    .nullable()
    .optional(),
});

export type WhoopSnapshotInput = z.infer<typeof whoopSnapshotSchema>;

// ========== WORKOUT SCHEMAS ==========

export const workoutExerciseSchema = z.object({
  name: z.string().min(1, 'Exercise name is required').max(100).trim(),
  sets: z.number().int().min(1).max(20),
  targetReps: z.number().int().min(1).max(100).optional(),
  targetWeight: z.string().max(20).optional(),
  notes: z.string().max(500).optional(),
});

export const createWorkoutSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  title: z.string().min(1, 'Workout title is required').max(200).trim(),
  recovery: z.string().max(100).optional(),
  exercises: z.array(workoutExerciseSchema).min(1, 'At least one exercise is required'),
});

export type CreateWorkoutInput = z.infer<typeof createWorkoutSchema>;
export type WorkoutExerciseInput = z.infer<typeof workoutExerciseSchema>;

// ========== QUERY PARAMETER SCHEMAS ==========

export const taskStatusQuerySchema = z
  .enum(['pending', 'in_progress', 'completed'])
  .optional();

export const whoopHistoryQuerySchema = z.object({
  days: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 7))
    .refine((val) => !isNaN(val) && val > 0 && val <= 90, {
      message: 'Days must be between 1 and 90',
    }),
});

export type WhoopHistoryQuery = z.infer<typeof whoopHistoryQuerySchema>;
