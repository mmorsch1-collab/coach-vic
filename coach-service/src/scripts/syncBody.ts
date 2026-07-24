import { syncBodyComp } from '../scheduler/bodyCompSync.js';

// One-off: backfill recent Withings readings into BODY_COMPOSITION now.
const days = Number(process.argv[2]) || 120;
syncBodyComp(days)
  .then((r) => {
    console.log('bodycomp sync:', JSON.stringify(r));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
