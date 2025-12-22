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
    // 클라이언트에서 이미 Canvas로 합성된 이미지를 받음
    const { compositeImage, aspectRatio = '16:9' } = req.body;

    if (!compositeImage) {
      return res.status(400).json({ error: '합성 이미지가 필요합니다' });
    }

    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    console.log('=== Canvas 합성 → Gemini 배경 통일 → Veo 영상화 ===');

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

    const compositeData = extractBase64(compositeImage);
    console.log('Canvas 합성 이미지 length:', compositeData.base64?.length);

    // Google Auth
    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // ========================================
    // STEP 1: Gemini로 배경만 자연스럽게 통일 (얼굴은 그대로!)
    // ========================================
    console.log('\n=== STEP 1: Gemini 배경 통일 ===');

    // 배경만 수정하는 프롬프트 - 얼굴은 절대 건드리지 않음
    const geminiPrompt = `This image shows two people side by side. Your task is to make the background look natural and unified.

⚠️ CRITICAL RULES - READ CAREFULLY ⚠️

🔴 DO NOT TOUCH THE FACES 🔴
- The faces of both people must remain EXACTLY as they are
- Do not modify, enhance, or change any facial features
- Do not alter skin tones
- Do not change hair
- The faces are PERFECT as they are - leave them alone

✅ YOUR ONLY TASK:
- Make the background behind both people look natural and unified
- Create a seamless transition where the two photos meet
- Add a nice, cohesive background (studio, cafe, outdoors, etc.)
- Keep both people's bodies and poses similar to the original

OUTPUT:
- Same two people with their EXACT original faces
- Natural, unified background
- Wide shot composition (waist up)
- Professional group photo look

Remember: You are ONLY editing the background. The faces must be pixel-perfect identical to the input.`;

    const geminiEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-exp:generateContent`;

    // 최대 3번 재시도
    let enhancedImageBase64 = null;
    let enhancedImageMimeType = 'image/png';
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`Gemini 배경 통일 시도 ${attempt}/3...`);

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
                { text: "Here is a composite photo of two people. Please unify the background while keeping their faces EXACTLY the same:" },
                {
                  inlineData: {
                    mimeType: compositeData.mimeType,
                    data: compositeData.base64,
                  }
                },
                { text: geminiPrompt }
              ]
            }],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT'],
              temperature: 0,
            },
          }),
        });

        const geminiData = await geminiResponse.json();

        if (!geminiResponse.ok) {
          console.error(`Gemini Error (attempt ${attempt}):`, geminiData.error?.message);
          lastError = geminiData.error?.message || 'Gemini API 오류';
          continue;
        }

        // 배경 통일된 이미지 추출
        if (geminiData.candidates?.[0]?.content?.parts) {
          for (const part of geminiData.candidates[0].content.parts) {
            if (part.inlineData) {
              enhancedImageBase64 = part.inlineData.data;
              enhancedImageMimeType = part.inlineData.mimeType || 'image/png';
              console.log(`배경 통일 이미지 생성됨 (attempt ${attempt}), length:`, enhancedImageBase64?.length);
              break;
            }
          }
        }

        if (enhancedImageBase64) {
          break; // 성공하면 루프 탈출
        } else {
          console.log(`Gemini가 이미지를 생성하지 않음 (attempt ${attempt})`);
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

    // Gemini 실패 시 원본 Canvas 합성 이미지 사용 (얼굴 100% 보존!)
    let finalImageBase64, finalImageMimeType;
    if (enhancedImageBase64) {
      console.log('Gemini 배경 통일 성공 - 향상된 이미지 사용');
      finalImageBase64 = enhancedImageBase64;
      finalImageMimeType = enhancedImageMimeType;
    } else {
      console.log('Gemini 실패 - 원본 Canvas 합성 이미지 사용 (얼굴 100% 보존)');
      finalImageBase64 = compositeData.base64;
      finalImageMimeType = compositeData.mimeType;
    }

    // ========================================
    // STEP 2: Veo로 영상 생성
    // ========================================
    console.log('\n=== STEP 2: Veo 영상화 ===');

    const videoPrompt = `Animate this photo of two people standing together into an 8-second video.

Animation:
- Both people smile naturally at the camera
- Subtle realistic movements: breathing, blinking, small head movements
- Friendly, casual atmosphere
- Keep the composition and framing similar to the input

IMPORTANT: Keep both faces exactly as shown in the photo. Do not change or morph the faces.`;

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
            bytesBase64Encoded: finalImageBase64,
            mimeType: finalImageMimeType,
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
