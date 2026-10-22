import {defineConfig} from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/firestore.rules.test.ts"],
    fileParallelism: false,
    // 초기 Emulator의 규칙 컴파일과 첫 SDK 연결을 포함한 통합 검사다.
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
