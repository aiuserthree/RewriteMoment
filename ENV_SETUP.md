# 환경 설정 가이드

## Replicate API 키 설정

1. [Replicate](https://replicate.com) 계정 생성
2. [API Tokens](https://replicate.com/account/api-tokens) 페이지에서 토큰 생성
3. Vercel 프로젝트 설정에서 환경 변수 추가:
   - 이름: `REPLICATE_API_TOKEN`
   - 값: `r8_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## 로컬 개발

```bash
# 의존성 설치
npm install

# 환경 변수 파일 생성
echo "REPLICATE_API_TOKEN=your_token_here" > .env.local

# 개발 서버 실행
npm run dev
```

## 가격 정보 (Replicate)

- **Stable Video Diffusion**: ~$0.03/초 (4초 영상 = ~$0.12)
- **Minimax Video**: ~$0.05/초
- **Kling**: 가격 다양

## API 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/upload` | POST | 이미지 업로드 |
| `/api/generate` | POST | 영상 생성 시작 |
| `/api/status/[id]` | GET | 생성 상태 확인 |

## 사용 예시

```javascript
// 영상 생성
const result = await VideoGenerator.createVideo(
  imageFile,
  {
    mode: 'quick',      // quick, story, trailer
    stage: '20s',       // teen, 20s, newlywed, parenting
    genre: 'drama',     // docu, comedy, drama, melo, fantasy
    rewriteText: '행복한 결말로',  // Optional
  },
  (progress) => {
    console.log(progress.message);
  }
);

console.log('Video URL:', result.videoUrl);
```





