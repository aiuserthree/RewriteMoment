import { GoogleAuth } from 'google-auth-library';
import Replicate from 'replicate';

// Google Cloud 설정
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'rewritemoment';
const LOCATION = 'us-central1';

const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON 
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : null;

// Replicate 설정
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

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

    console.log('=== Face Swap + Gemini + Veo 파이프라인 ===');

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
    // STEP 1: Gemini로 두 사람이 함께 있는 장면 생성
    // ========================================
    console.log('\n=== STEP 1: Gemini 장면 생성 ===');

    const geminiPrompt = `Create a photo showing two people together in a friendly group photo.

COMPOSITION:
- Two people standing side by side
- Wide shot from waist up
- Person on LEFT, another person on RIGHT
- Natural friendly poses, both smiling
- Nice background (cafe, studio, park)

IMPORTANT: Generate a scene with two generic people in the described poses. The faces will be replaced later, so focus on body positions, lighting, and background.

OUTPUT: A natural group photo scene with two people.`;

    const geminiEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-exp:generateContent`;

    // 최대 3번 재시도
    let sceneImageBase64 = null;
    let sceneImageMimeType = 'image/png';
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
                { text: "Reference for Person A (will be on LEFT):" },
                {
                  inlineData: {
                    mimeType: myPhotoData.mimeType,
                    data: myPhotoData.base64,
                  }
                },
                { text: "Reference for Person B (will be on RIGHT):" },
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
              temperature: 0.7,
            },
          }),
        });

        const geminiData = await geminiResponse.json();

        if (!geminiResponse.ok) {
          console.error(`Gemini Error (attempt ${attempt}):`, geminiData.error?.message);
          lastError = geminiData.error?.message || 'Gemini API 오류';
          continue;
        }

        // 장면 이미지 추출
        if (geminiData.candidates?.[0]?.content?.parts) {
          for (const part of geminiData.candidates[0].content.parts) {
            if (part.inlineData) {
              sceneImageBase64 = part.inlineData.data;
              sceneImageMimeType = part.inlineData.mimeType || 'image/png';
              console.log(`장면 이미지 생성됨 (attempt ${attempt}), length:`, sceneImageBase64?.length);
              break;
            }
          }
        }

        if (sceneImageBase64) {
          break;
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

      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!sceneImageBase64) {
      console.error('모든 Gemini 시도 실패');
      return res.status(500).json({ 
        error: '이미지 합성 실패', 
        details: lastError || 'Gemini가 합성 이미지를 생성하지 못했습니다. 다른 사진으로 다시 시도해주세요.' 
      });
    }

    // ========================================
    // STEP 2: Replicate Face Swap으로 얼굴 교체 (선택적)
    // ========================================
    let finalImageBase64 = sceneImageBase64;
    let finalImageMimeType = sceneImageMimeType;

    // Replicate API가 있으면 Face Swap 시도
    if (process.env.REPLICATE_API_TOKEN) {
      console.log('\n=== STEP 2: Replicate Face Swap ===');
      try {
        // Face swap 모델로 얼굴 교체 시도
        const sceneDataUrl = `data:${sceneImageMimeType};base64,${sceneImageBase64}`;
        
        const faceSwapOutput = await replicate.run(
          "lucataco/facefusion:71dfcecc1e0239a63fa9c92c84456b7dddf95e5df1787fc1b56e0f3b86c01d45",
          {
            input: {
              source_image: myPhoto,  // 내 얼굴
              target_image: sceneDataUrl,  // Gemini가 생성한 장면
              face_selector_mode: "one"
            }
          }
        );

        if (faceSwapOutput) {
          console.log('Face Swap 성공!');
          // 결과 URL에서 이미지 다운로드
          const swappedResponse = await fetch(faceSwapOutput);
          const swappedBuffer = await swappedResponse.arrayBuffer();
          finalImageBase64 = Buffer.from(swappedBuffer).toString('base64');
          finalImageMimeType = 'image/png';
        }
      } catch (faceSwapError) {
        console.log('Face Swap 실패, Gemini 이미지 사용:', faceSwapError.message);
        // Face swap 실패해도 Gemini 이미지로 계속 진행
      }
    } else {
      console.log('Replicate API 없음 - Gemini 이미지 그대로 사용');
    }

    // ========================================
    // STEP 3: Veo로 영상 생성
    // ========================================
    console.log('\n=== STEP 3: Veo 영상화 ===');

    const videoPrompt = `Animate this photo of two friends into an 8-second video.

Animation: Both people smile and pose naturally. Subtle movements like breathing and blinking. Friendly atmosphere. Warm lighting.

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
