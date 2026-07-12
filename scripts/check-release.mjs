import { access, readFile } from 'node:fs/promises';
import process from 'node:process';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function containsUnknown(path) {
  if (!(await exists(path))) return true;
  return (await readFile(path, 'utf8')).includes('확정 필요');
}

async function readJson(path) {
  if (!(await exists(path))) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

const firebaseReadiness = await readJson('firebase/release-readiness.json');

const sections = [
  {
    market: 'Architecture',
    blockers: (await exists('packages/product-core/src')) ? [] : ['product-core 미구현'],
  },
  {
    market: 'Firebase',
    blockers: [
      !(await exists('firebase/firestore.rules')) && 'Security Rules 미구현',
      !(await exists('.firebaserc')) && 'Firebase project ID 확정 필요',
      !firebaseReadiness?.productionProjectConfigured && '운영 Firebase 프로젝트 미확정',
      !firebaseReadiness?.billingLinked && '결제 계정 연결 미완료',
      !firebaseReadiness?.functionsDeployed && 'Cloud Functions 실제 배포 미검증',
      !firebaseReadiness?.productionAuthConfigured && '운영 로그인 제공자 미확정',
      !firebaseReadiness?.appCheckEnforced && 'App Check 강제 미검증',
    ].filter(Boolean),
  },
  {
    market: 'Google Play',
    blockers: [
      (await containsUnknown('play-store/google-play.config.json')) && '출시 package/콘솔 메타데이터 확정 필요',
      '서명된 AAB 및 Console 입력 미검증',
    ],
  },
  {
    market: 'App Store',
    blockers: [
      (await containsUnknown('app-store/app-store.config.json')) && '출시 bundle ID/콘솔 메타데이터 확정 필요',
      'archive/TestFlight/App Store Connect 입력 미검증',
    ],
  },
  {
    market: 'AppsInToss',
    blockers: [
      '민감 건강정보·계정·구독 정책 적합성 확인 필요',
      '영구 appName 확정 및 apps/ait 스캐폴드 필요',
    ],
  },
  {
    market: 'Privacy',
    blockers: ['민감정보 별도 동의문·개인정보 처리방침·Data safety/privacy labels 최종 확정 필요'],
  },
];

console.log(JSON.stringify({ ready: false, sections }, null, 2));
process.exitCode = 1;
