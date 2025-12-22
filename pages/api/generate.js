import { GoogleAuth } from 'google-auth-library';
import jwt from 'jsonwebtoken';

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

    const geminiPrompt = `Create a photo of these two people as CLOSE FRIENDS together in the SAME SPACE.

SCENE: Two friends standing close together, shoulders nearly touching, like they're taking a selfie or group photo together. They share the SAME background, SAME lighting, SAME environment. It should look like ONE photo taken of TWO people together - not two separate photos combined.

COMPOSITION:
- Person from Photo 1 on LEFT
- Person from Photo 2 on RIGHT  
- They are CLOSE to each other (friendly distance, not far apart)
- Bodies slightly angled toward each other
- Natural poses like real friends taking a photo
- SINGLE unified background behind both (cafe, studio, park - same for both)
- SAME lighting on both faces
- Upper body shot (waist to head)

FACE PRESERVATION (HIGHEST PRIORITY):

⚠️ PERSON ON LEFT (from Photo 1) - PRESERVE WITH EXTREME CARE:
This face is the MOST IMPORTANT to preserve exactly.
- EXACT same eye shape, size, color, spacing as Photo 1
- EXACT same nose - bridge width, tip shape, nostril size as Photo 1
- EXACT same lips and mouth shape as Photo 1
- EXACT same face shape - jawline, chin, cheekbones as Photo 1
- EXACT same skin tone and any facial marks as Photo 1
- EXACT same eyebrows and hairline as Photo 1
- EXACT same hair color and style as Photo 1
DO NOT modify this face AT ALL. Copy it EXACTLY.

PERSON ON RIGHT (from Photo 2):
- EXACT same facial features as Photo 2
- Same eyes, nose, lips, face shape, skin tone as Photo 2

CRITICAL: Both faces must be IDENTICAL to their source photos. No new faces. No blending. No modifications.

Make it look like they are truly TOGETHER in one moment, one place, one photo.`;

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
              temperature: 0,  // 0 = 최대 일관성, 랜덤성 제거
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
    // STEP 2: 영상 생성 (Kling AI 또는 Veo)
    // ========================================
    
    // Kling API 키가 있으면 Kling 사용, 없으면 Veo 사용
    const useKling = KLING_ACCESS_KEY && KLING_ACCESS_SECRET;
    
    if (useKling) {
      console.log('\n=== STEP 2: Kling AI 영상화 ===');
      
      // JWT 토큰 생성 (Kling AI 인증)
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

      const klingResponse = await fetch('https://api.klingai.com/v1/videos/image2video', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${klingToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_name: 'kling-v1',
          image: `data:${compositeImageMimeType};base64,${compositeImageBase64}`,
          prompt: 'Animate this photo. Two friends in same space, natural interaction. CRITICAL FACE PRESERVATION: The LEFT person face must be EXACTLY IDENTICAL to the photo - same eye shape, same nose, same lips, same jawline, same skin tone. The RIGHT person face must also be EXACTLY IDENTICAL to the photo. Do NOT change, morph, or alter ANY facial features. Faces must look like the SAME PEOPLE as in the photo. Allow gentle movement but faces stay EXACTLY as shown. Warm cinematic.',
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
    } else {
      // Veo로 fallback
      console.log('\n=== STEP 2: Veo 영상화 (Kling 키 없음) ===');
      
      const veoEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/veo-2.0-generate-001:predictLongRunning`;

      const videoPrompt = `Animate this photo. CRITICAL: LEFT person face must be EXACTLY IDENTICAL to photo - same eyes, nose, lips, jaw, skin. RIGHT person face must also be EXACTLY IDENTICAL. Do NOT change or morph any facial features. They must look like the SAME PEOPLE. Gentle natural movement but faces stay EXACTLY as shown. Warm cinematic. 8 seconds.`;

      const auth = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();

      const veoResponse = await fetch(veoEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instances: [{
            prompt: videoPrompt,
            image: {
              bytesBase64Encoded: compositeImageBase64,
              mimeType: compositeImageMimeType,
            },
          }],
          parameters: {
            aspectRatio: aspectRatio || '16:9',
            sampleCount: 1,
            durationSeconds: 8,
            personGeneration: 'allow_adult',
          },
        }),
      });

      const veoData = await veoResponse.json();

      if (!veoResponse.ok) {
        console.error('Veo Error:', veoData);
        return res.status(500).json({ 
          error: 'Veo 영상 생성 실패',
          details: veoData.error?.message || JSON.stringify(veoData)
        });
      }

      console.log('Veo 작업 시작:', veoData.name);

      return res.status(200).json({
        id: veoData.name,
        status: 'processing',
        message: 'Gemini 합성 완료 → Veo 영상 생성 중',
        provider: 'veo',
      });
    }

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
