import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/** Creates a fresh SQLite test database by applying all migrations. */
export default function setup() {
  const dir = path.resolve(__dirname, "../prisma");
  for (const file of ["test.db", "test.db-journal"]) rmSync(path.join(dir, file), { force: true });
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
