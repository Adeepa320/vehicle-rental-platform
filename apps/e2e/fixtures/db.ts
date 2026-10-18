import { spawnSync } from 'node:child_process';

const CONTAINER = process.env.E2E_DB_CONTAINER ?? 'vehicle-rental-db';
const DATABASE = process.env.E2E_DB_NAME ?? 'vehicle_rental';

/**
 * Runs one SQL statement inside the Docker database container and returns the
 * trimmed, tuples-only output. Used only where a scenario needs the clock to
 * move (an elapsed payment window); never for assertions the API can answer.
 */
export function sql(statement: string): string {
  const result = spawnSync(
    'docker',
    [
      'exec',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      DATABASE,
      '-v',
      'ON_ERROR_STOP=1',
      '-tAc',
      statement,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}
