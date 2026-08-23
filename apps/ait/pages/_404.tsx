import { ErrorPage } from '@toss/tds-react-native';

export default function NotFoundPage() {
  return <ErrorPage statusCode={404} title="페이지를 찾을 수 없어요" />;
}
