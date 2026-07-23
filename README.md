# EAS v0.9.0

eBay 소싱 현장에서 사진, UPC/EAN 바코드, 매입가, 예상 판매가를 기록하고 예상 수익과 BUY CONFIDENCE를 계산하는 iPhone 우선 PWA입니다.

## v0.9.0 주요 기능
- iPhone 바코드 자동 판독 폴백
- 사진 최대 6장 저장 및 대표 사진
- AI Assistant Beta UI
- AI 제안: 브랜드, 상품명, 카테고리, 색상, 상태, 신뢰도, eBay 검색어
- eBay 새상품 검색 바로가기
- BUY / CONSIDER / PASS와 순이익·ROI 계산

## AI 연결
정적 GitHub Pages에 비밀 API 키를 넣지 않습니다. 설정 화면에서 별도의 HTTPS AI 분석 서버 주소를 입력합니다. 요청/응답 형식은 `docs/AI_ENDPOINT_CONTRACT.md`를 참고하세요.

AI 서버가 연결되지 않은 상태에서도 기존 사진, 바코드, 저장, 수익 계산 기능은 그대로 동작합니다.


## v1.1.0
- 중앙은행 자료 기반 USD/KRW 최신 기준환율 자동 조회
- 최신환율 / 보수환율 / 직접입력 모드
- 상품 저장 시 적용 환율 스냅샷 보관
- Gemini 일시 오류 자동 재시도 2회
- AI 결과 헤드라인 개선 (`상품 식별 완료`, `모델 확인 필요`)
