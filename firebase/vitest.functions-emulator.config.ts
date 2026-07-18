import {defineConfig} from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/functions.emulator.test.ts"],
    fileParallelism: false,
    // 계정삭제·구독 E2E는 emulator 왕복이 많아 느린 CI 러너에서 60s를 초과한다.
    // job 예산(40분) 대비 충분한 여유를 두어 성능 편차에 강건하게 한다.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
