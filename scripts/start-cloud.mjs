import { spawn } from "node:child_process";
import { validateDeployment } from "./deployment-config.mjs";
const errors = validateDeployment(process.env);
if (errors.length) { errors.forEach((error) => console.error(error)); process.exit(1); }
const port = process.env.PORT ?? "3000";
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) { console.error("서비스 포트 설정을 확인해 주세요."); process.exit(1); }
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", port], { stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("서비스를 시작하지 못했습니다."); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
