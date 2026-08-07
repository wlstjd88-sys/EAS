# EAS System Architecture

## Project Overview

EAS (AI Product Sourcing System for Coupang)

목표

코스트코 온라인몰 상품을 자동 분석하여
쿠팡에서 판매 가능한 상품을 추천하고
예상 순이익과 ROI를 계산하는 AI 시스템

---

## Version 1.0

### Product Source

- Costco Online

### Marketplace

- Coupang

### Functions

- 상품 수집
- 가격 수집
- 쿠팡 검색
- 수수료 계산
- 배송비 계산
- 예상 순이익 계산
- ROI 계산
- 위험도 분석
- AI 구매 추천

---

## AI Workflow

Costco

↓

상품 수집

↓

쿠팡 검색

↓

동일상품 찾기

↓

예상 판매가 계산

↓

수수료 계산

↓

배송비 계산

↓

순이익 계산

↓

ROI 계산

↓

AI 추천

★★★★★ 구매 추천

★★★ 보류

★ 비추천

---

## Future Expansion

Product Sources

- Traders
- E-Mart
- Homeplus
- Amazon
- Walmart

Marketplace

- Coupang
- Naver
- 11Street
- Gmarket
- Auction

---

## Technology

Frontend

- React

Backend

- Python

Database

- SQLite
- PostgreSQL

AI

- OpenAI

Deployment

- GitHub
