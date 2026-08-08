import { appsInToss } from '@apps-in-toss/framework/plugins';
import { defineConfig } from '@granite-js/react-native/config';

export default defineConfig({
  scheme: 'intoss',
  // Console 등록 전 빌드용 후보다. 등록 시 Console appName과 반드시 대조한다.
  appName: 'cycle-pair',
  plugins: [
    appsInToss({
      brand: {
        displayName: '사이클 페어 : 내 기분, 주기, 컨디션을 알려요',
        primaryColor: '#76558F',
        // Console 앱 생성 후 업로드한 600x600 로고의 HTTPS URL로 교체한다.
        icon: 'https://placehold.co/600x600/76558F/FFFFFF.png?text=CP',
      },
      permissions: [],
    }),
  ],
});
