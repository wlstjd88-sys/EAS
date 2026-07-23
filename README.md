# EAS v0.8.0

eBay 소싱 현장에서 상품 사진, UPC/EAN 바코드, 매입가와 예상 판매가를 기록하고 예상 수익 및 BUY CONFIDENCE를 계산하는 iPhone 우선 PWA입니다.

## v0.8.0 주요 기능

- UPC-A(12자리), EAN-8(8자리), EAN-13(13자리) 입력 및 체크 숫자 검증
- 카메라 촬영 이미지의 바코드 자동 판독 시도 (`BarcodeDetector` 지원 브라우저)
- 자동 판독 미지원/실패 시 수동 숫자 입력
- 상품 사진 최대 6장, 대표 사진 및 상세 갤러리
- 바코드 포함 상품 검색
- 예상 순이익, ROI, 마진율, BUY / CONSIDER / PASS, BUY CONFIDENCE
- 환율·수수료·광고율·반품 충당률·배송비·포장비·목표값 설정
- v0.4.0/v0.6.1/v0.7.0 로컬 데이터 자동 이전
- JSON 데이터 백업

## 로컬 실행

```bash
python3 serve.py
```

브라우저에서 `http://localhost:8000`을 엽니다.

## 주의

상품 데이터와 사진은 현재 브라우저의 localStorage에 저장됩니다. iPhone 브라우저에 따라 `BarcodeDetector`가 지원되지 않을 수 있으며, 이 경우 바코드 숫자를 직접 입력해야 합니다.
