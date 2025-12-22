import { GoogleAuth } from 'google-auth-library';

// Google Cloud 설정
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'rewritemoment';
const LOCATION = 'us-central1';

const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON 
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : null;

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

    console.log('=== Gemini 합성 → Veo 영상화 ===');

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
    // STEP 1: Gemini로 두 사진 합성
    // ========================================
    console.log('\n=== STEP 1: Gemini 합성 ===');

    // 얼굴 보존 강화 프롬프트
    const geminiPrompt = `You are a photo editing expert. Your task is to create a composite image.

INPUT IMAGES:
- Reference Face A: The first image (USE THIS EXACT FACE for Person A)
- Reference Face B: The second image (USE THIS EXACT FACE for Person B)

TASK:
Create a new image where Person A and Person B appear together, side by side, like friends taking a selfie.

⚠️ CRITICAL FACE PRESERVATION RULES ⚠️

For Person A (left side):
- MUST use the EXACT face from Reference Face A
- Same eyes (shape, color, size, distance)
- Same nose (shape, size, bridge)
- Same mouth (shape, lips)
- Same face shape (jawline, chin, cheekbones)
- Same skin tone and texture
- Same eyebrows (shape, thickness)
- Same hair (color, style)

For Person B (right side):
- MUST use the EXACT face from Reference Face B
- Same eyes (shape, color, size, distance)
- Same nose (shape, size, bridge)
- Same mouth (shape, lips)
- Same face shape (jawline, chin, cheekbones)
- Same skin tone and texture
- Same eyebrows (shape, thickness)
- Same hair (color, style)

🚫 FORBIDDEN:
- Do NOT create new or different faces
- Do NOT blend or morph the faces
- Do NOT change facial proportions
- Do NOT alter skin tones
- Do NOT modify any facial features

COMPOSITION:
- Person A on LEFT, Person B on RIGHT
- Both facing camera, natural smiles
- Selfie-style composition
- Warm, friendly lighting

The faces must be IDENTICAL to the reference images. This is a face-swap/composite task, not face generation.`;

    const geminiEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-exp:generateContent`;

    // 최대 3번 재시도
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
                { text: "=== Reference Face A (Person A - USE THIS EXACT FACE on LEFT side) ===" },
                {
                  inlineData: {
                    mimeType: myPhotoData.mimeType,
                    data: myPhotoData.base64,
                  }
                },
                { text: "=== Reference Face B (Person B - USE THIS EXACT FACE on RIGHT side) ===" },
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
              temperature: 0.4,  // 낮은 temperature로 더 정확하게
            },
          }),
        });

        const geminiData = await geminiResponse.json();

        if (!geminiResponse.ok) {
          console.error(`Gemini Error (attempt ${attempt}):`, geminiData.error?.message);
          lastError = geminiData.error?.message || 'Gemini API 오류';
          continue;
        }

        // 합성된 이미지 추출
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
          break; // 성공하면 루프 탈출
        } else {
          console.log(`Gemini가 이미지를 생성하지 않음 (attempt ${attempt})`);
          // 텍스트 응답이 있으면 출력
          const textParts = geminiData.candidates?.[0]?.content?.parts?.filter(p => p.text);
          if (textParts?.length) {
            console.log('Gemini 텍스트 응답:', textParts.map(p => p.text).join('\n'));
          }
          lastError = 'Gemini가 이미지를 생성하지 못했습니다';
        }

      } catch (fetchError) {
        console.error(`Gemini fetch error (attempt ${attempt}):`, fetchError.message);
        lastError = fetchError.message;
      }

      // 재시도 전 잠시 대기
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // 모든 시도 실패
    if (!compositeImageBase64) {
      console.error('모든 Gemini 시도 실패');
      return res.status(500).json({ 
        error: '이미지 합성 실패', 
        details: lastError || 'Gemini가 합성 이미지를 생성하지 못했습니다. 다른 사진으로 다시 시도해주세요.' 
      });
    }

    // ========================================
    // STEP 2: Veo로 영상 생성
    // ========================================
    console.log('\n=== STEP 2: Veo 영상화 ===');

    const videoPrompt = `Create a short video from this photo of two friends.

Animation: Both people smile and pose naturally. Subtle movements like breathing and blinking. Friendly, casual atmosphere. Warm natural lighting.

Keep both faces exactly as shown in the photo.`;

    const veoEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/veo-2.0-generate-001:predictLongRunning`;

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
          aspectRatio: aspectRatio,
          sampleCount: 1,
          durationSeconds: 8,
          personGeneration: 'allow_adult',
        },
      }),
    });

    const veoData = await veoResponse.json();

    if (!veoResponse.ok) {
      console.error('Veo Error:', JSON.stringify(veoData, null, 2));
      return res.status(500).json({ 
        error: 'Veo 영상 생성 실패',
        details: veoData.error?.message
      });
    }

    console.log('Veo 시작:', veoData.name);

    return res.status(200).json({
      id: veoData.name,
      status: 'processing',
      message: 'Gemini 합성 완료 → 영상 생성 중',
      provider: 'google-veo',
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
