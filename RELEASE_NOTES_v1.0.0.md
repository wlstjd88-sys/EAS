# EAS v1.0.0 Gemini 연동

- Cloudflare Worker용 실제 Gemini 이미지 분석 코드 추가
- 기본 Worker 주소 연결
- 사진 최대 3장 분석
- 브랜드, 상품명, 카테고리, 색상, 상태, 신뢰도, eBay 검색어, 요약 반환
- GitHub Pages 출처 제한(CORS)
- Gemini API 키는 Cloudflare Secret에서만 읽음

## 아직 필요한 사용자 작업
Cloudflare Worker에 `worker.js`를 실제 배포해야 합니다. 패키지만 GitHub Pages에 올리면 AI는 동작하지 않습니다.
