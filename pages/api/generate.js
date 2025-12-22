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

    console.log('=== 2장 합성 → Veo 영상화 ===');

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
    console.log('배우 사진 length:', actorPhotoData.base64?.length);

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

    const geminiPrompt = `You are an expert photo editor.

I'm giving you TWO photos:
1. Photo 1 (first image): This is ME - the main person
2. Photo 2 (second image): This is another person I want to take a photo WITH

Create a NEW composite image where:
- I (from Photo 1) am on the LEFT side, holding up my phone like taking a selfie
- The person from Photo 2 is on the RIGHT side, posing with me
- We are both smiling at the camera like friends taking a selfie together
- The background is a movie set with professional lighting equipment visible

CRITICAL REQUIREMENTS:
- My face (from Photo 1) must look EXACTLY the same - same face shape, eyes, nose, mouth, skin tone
- The other person's face (from Photo 2) must also look EXACTLY the same
- DO NOT change or morph either face
- Make it look like a natural selfie photo

Style: Candid selfie photo, warm natural lighting, friendly atmosphere, 8K quality`;

    const geminiEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-exp:generateContent`;

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
            {
              inlineData: {
                mimeType: myPhotoData.mimeType,
                data: myPhotoData.base64,
              }
            },
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
          temperature: 1.0,
        },
      }),
    });

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Gemini Error:', JSON.stringify(geminiData, null, 2));
      return res.status(500).json({ 
        error: 'Gemini 합성 실패', 
        details: geminiData.error?.message 
      });
    }

    // 합성된 이미지 추출
    let compositeImageBase64 = null;
    let compositeImageMimeType = 'image/png';

    if (geminiData.candidates?.[0]?.content?.parts) {
      for (const part of geminiData.candidates[0].content.parts) {
        if (part.inlineData) {
          compositeImageBase64 = part.inlineData.data;
          compositeImageMimeType = part.inlineData.mimeType || 'image/png';
          console.log('합성 이미지 생성됨, length:', compositeImageBase64?.length);
          break;
        }
      }
    }

    // Gemini가 이미지를 생성하지 않으면 에러
    if (!compositeImageBase64) {
      console.error('Gemini가 합성 이미지를 생성하지 않음');
      console.error('Gemini response:', JSON.stringify(geminiData, null, 2));
      return res.status(500).json({ 
        error: '이미지 합성 실패', 
        details: 'Gemini가 합성 이미지를 생성하지 못했습니다. 다른 사진으로 다시 시도해주세요.' 
      });
    }

    // ========================================
    // STEP 2: Veo로 영상 생성
    // ========================================
    console.log('\n=== STEP 2: Veo 영상화 ===');

    const videoPrompt = `Animate this photo into an 8-second video.

CRITICAL: Both people's faces must stay EXACTLY the same throughout the video.
- Do NOT change any facial features
- Do NOT morph faces
- Keep faces identical to this input image

Animation:
0-2 sec: Both people smile and pose for the selfie
2-4 sec: The person holding the phone adjusts the angle
4-6 sec: Both laugh naturally, share a moment
6-8 sec: They high-five and wave goodbye to camera

Style: Behind-the-scenes vlog footage, candid and warm, natural lighting, slight handheld camera shake.

IMPORTANT: Both faces must remain 100% identical to the input image!`;

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
      message: '합성 완료 → 영상 생성 중',
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
    bodyParser: { sizeLimit: '20mb' }, // 이미지 2장이므로 크기 증가
    responseLimit: false,
  },
};
