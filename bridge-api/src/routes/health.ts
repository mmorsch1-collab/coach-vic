import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { HealthCheckResponse } from '../types.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const response: HealthCheckResponse = {
      ok: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
    res.json(response);
  })
);

export default router;
