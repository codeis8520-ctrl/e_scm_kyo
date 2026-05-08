import NotificationTemplateClassifier from '@/components/notifications/NotificationTemplateClassifier';

// /notifications 페이지의 "템플릿 관리" 탭과 동일한 컴포넌트를 렌더링.
// 별도 라우트는 외부 직접 링크 / 북마크 호환 용도로 유지.
export default function NotificationTemplatesPage() {
  return <NotificationTemplateClassifier />;
}
