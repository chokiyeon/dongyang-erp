import test from "node:test";
import assert from "node:assert/strict";
import { validateDeployment } from "../scripts/deployment-config.mjs";
test("운영 배포는 개발 DB·약한 접근 설정·HTTP를 거절하고 비밀값을 출력하지 않는다", () => {
  const valid = { ERP_ADMIN_PASSWORD: "test-only-long-password", ERP_SESSION_SECRET: "test-only-random-session-key-at-least-32", DATABASE_URL: "postgresql://user:test-secret@private-db/erp", ERP_COOKIE_SECURE: "true", RENDER_EXTERNAL_URL: "https://example.onrender.com" };
  assert.deepEqual(validateDeployment(valid),[]);
  const errors = validateDeployment({ ...valid, ERP_COOKIE_SECURE: "false", DATABASE_URL: "postgresql://user:local-development-only@127.0.0.1/erp", RENDER_EXTERNAL_URL:"http://example.com" });
  assert.ok(errors.length >= 3); assert.ok(!errors.join(" ").includes("postgresql://"));
  assert.ok(validateDeployment({ ...valid, ERP_ADMIN_PASSWORD:"short" }).length);
  assert.ok(validateDeployment({ ...valid, ERP_SESSION_SECRET:valid.ERP_ADMIN_PASSWORD }).length);
});
