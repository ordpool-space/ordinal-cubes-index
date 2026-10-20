// Entry-point runner shared by the executable scripts. Runs the script's
// `main`, and on any unhandled rejection prints it under a `FATAL:` marker and
// exits non-zero so a failed grind or backfill fails its shell and its CI step
// loudly rather than exiting 0 with a stack trace in the log.

export function runMain(main) {
  main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
