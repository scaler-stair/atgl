// Runs the golden test set against an in-process PostgreSQL (PGlite) so the
// Postgres (Neon) code path is verified without any external database.
//   npm run test:postgres
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = 55432;
const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 4 });
await server.start();

const code = await new Promise((resolve) => {
  const child = spawn("npx", ["tsx", "--conditions=react-server", "--test", "tests/golden.test.ts"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, DATABASE_POOL_SIZE: "2" },
  });
  child.on("exit", (c) => resolve(c ?? 1));
});

await server.stop();
await db.close();
process.exit(code);
