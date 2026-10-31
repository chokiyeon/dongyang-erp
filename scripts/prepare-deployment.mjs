import { spawnSync } from "node:child_process";
import { validateDeployment } from "./deployment-config.mjs";
const errors = validateDeployment(process.env);
if (errors.length) { errors.forEach((error) => console.error(error)); process.exit(1); }
const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { stdio: "inherit" });
process.exit(result.status ?? 1);
