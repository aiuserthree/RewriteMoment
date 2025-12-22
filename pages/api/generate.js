import { GoogleAuth } from 'google-auth-library';

// Google Cloud 설정
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'rewritemoment';
const LOCATION = 'us-central1';

const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON 
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : null;

// Kling AI 설정
const KLING_ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const KLING_ACCESS_SECRET = process.env.KLING_ACCESS_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { myPhoto, actorPhoto, aspectRatio = '16:9' } = req.body;

    if (!myPhoto || !actorPhoto) {
      return res.status(400).json({ error: '사진 2장이 필요합니다' });
    }

    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    console.log('=== Gemini 합성 → Kling 영상화 파이프라인 ===');

    // 이미지 Base64 처리
    function extractBase64(imageUrl) {
      if (imageUrl.startsWith('data:')) {
        const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          return { mimeType: matches[1], base64: matches[2] };
        }
        return { mimeType: 'image/jpeg', base64: imageUrl.split(',')[1] };
      }
      return { mimeType: 'image/jpeg', base64: imageUrl };
    }

    const myPhotoData = extractBase64(myPhoto);
    const actorPhotoData = extractBase64(actorPhoto);

    console.log('내 사진 length:', myPhotoData.base64?.length);
    console.log('함께할 사람 사진 length:', actorPhotoData.base64?.length);

    // Google Auth
    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // ========================================
    // STEP 1: Gemini로 두 사람이 함께 있는 이미지 합성
    // ========================================
    console.log('\n=== STEP 1: Gemini(나노바나나) 합성 ===');

    const geminiPrompt = `Create a photo of these two people together, like friends taking a group photo.

COMPOSITION:
- Person from Image 1 on the LEFT
- Person from Image 2 on the RIGHT
- Wide shot showing from waist up
- Natural group photo style
- Nice background (cafe, studio, park)

FACE PRESERVATION:
- Keep Person 1's face exactly as shown in Image 1
- Keep Person 2's face exactly as shown in Image 2
- Do not modify facial features
- Preserve skin tones and hair

OUTPUT: A natural-looking group photo with both people together.`;

    const geminiEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-exp:generateContent`;

    let compositeImageBase64 = null;
    let compositeImageMimeType = 'image/png';
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`Gemini 시도 ${attempt}/3...`);

      try {
        const geminiResponse = await fetch(geminiEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: "Image 1 (Person A - LEFT):" },
                {
                  inlineData: {
                    mimeType: myPhotoData.mimeType,
                    data: myPhotoData.base64,
                  }
                },
                { text: "Image 2 (Person B - RIGHT):" },
                {
                  inlineData: {
                    mimeType: actorPhotoData.mimeType,
                    data: actorPhotoData.base64,
                  }
                },
                { text: geminiPrompt }
              ]
            }],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT'],
              temperature: 0.5,
            },
          }),
        });

        const geminiData = await geminiResponse.json();

        if (!geminiResponse.ok) {
          console.error(`Gemini Error (attempt ${attempt}):`, geminiData.error?.message);
          lastError = geminiData.error?.message || 'Gemini API 오류';
          continue;
        }

        if (geminiData.candidates?.[0]?.content?.parts) {
          for (const part of geminiData.candidates[0].content.parts) {
            if (part.inlineData) {
              compositeImageBase64 = part.inlineData.data;
              compositeImageMimeType = part.inlineData.mimeType || 'image/png';
              console.log(`합성 이미지 생성됨 (attempt ${attempt}), length:`, compositeImageBase64?.length);
              break;
            }
          }
        }

        if (compositeImageBase64) {
          break;
        } else {
          console.log(`Gemini가 이미지를 생성하지 않음 (attempt ${attempt})`);
          lastError = 'Gemini가 이미지를 생성하지 못했습니다';
        }

      } catch (fetchError) {
        console.error(`Gemini fetch error (attempt ${attempt}):`, fetchError.message);
        lastError = fetchError.message;
      }

      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!compositeImageBase64) {
      return res.status(500).json({ 
        error: '이미지 합성 실패', 
        details: lastError || 'Gemini가 합성 이미지를 생성하지 못했습니다.' 
      });
    }

    // ========================================
    // STEP 2: Kling AI로 영상 생성
    // ========================================
    console.log('\n=== STEP 2: Kling AI 영상화 ===');

    // Kling AI API 호출
    const klingEndpoint = 'https://api.klingai.com/v1/videos/image2video';
    
    // JWT 토큰 생성 (Kling AI 인증)
    const jwt = require('jsonwebtoken');
    const now = Math.floor(Date.now() / 1000);
    const klingToken = jwt.sign(
      {
        iss: KLING_ACCESS_KEY,
        exp: now + 1800, // 30분
        nbf: now - 5,
      },
      KLING_ACCESS_SECRET,
      { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
    );

    const klingResponse = await fetch(klingEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${klingToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_name: 'kling-v1',
        image: `data:${compositeImageMimeType};base64,${compositeImageBase64}`,
        prompt: 'Two friends smiling and posing naturally. Subtle movements like breathing and blinking. Friendly atmosphere. Keep faces exactly as shown.',
        duration: '5',
        aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9',
        mode: 'std',
      }),
    });

    const klingData = await klingResponse.json();

    if (!klingResponse.ok || klingData.code !== 0) {
      console.error('Kling Error:', klingData);
      return res.status(500).json({ 
        error: 'Kling 영상 생성 실패',
        details: klingData.message || klingData.error?.message
      });
    }

    console.log('Kling 작업 시작:', klingData.data?.task_id);

    return res.status(200).json({
      id: klingData.data?.task_id,
      status: 'processing',
      message: 'Gemini 합성 완료 → Kling 영상 생성 중',
      provider: 'kling',
    });

  } catch (error) {
    console.error('전체 에러:', error);
    return res.status(500).json({ 
      error: '영상 생성 실패',
      details: error.message
    });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '20mb' },
    responseLimit: false,
  },
};
