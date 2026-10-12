// Creates a local .env from .env.example (if missing) with a random AUTH_SECRET.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const PLACEHOLDER = "replace-me-with-a-random-secret";

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example");
}

const env = readFileSync(".env", "utf8");
if (env.includes(PLACEHOLDER)) {
  writeFileSync(".env", env.replace(PLACEHOLDER, randomBytes(32).toString("base64url")));
  console.log("Generated a random AUTH_SECRET in .env");
}
