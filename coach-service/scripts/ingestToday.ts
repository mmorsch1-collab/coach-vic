/** One-off: ingest a date's filled Workout_<date> sheet into WORKOUT_DATABASE (deduped). */
import 'dotenv/config';
import { ingestWorkout } from '../src/coaching/workoutIngest.js';

const date = process.argv[2] || undefined;
ingestWorkout(date)
  .then((r) => {
    console.log(JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error('ingest failed:', e?.message ?? e);
    process.exit(1);
  });
