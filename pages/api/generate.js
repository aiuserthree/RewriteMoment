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
    // 클라이언트에서 이미 합성된 이미지를 받음 (Canvas로 나란히 합성된 상태)
    const { compositeImage, aspectRatio = '16:9' } = req.body;

    if (!compositeImage) {
      return res.status(400).json({ error: '합성 이미지가 필요합니다' });
    }

    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    console.log('=== 클라이언트 합성 → Veo 영상화 ===');

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
    console.log('합성 이미지 length:', compositeData.base64?.length);

    // Google Auth
    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // ========================================
    // Veo로 영상 생성 (합성은 이미 클라이언트에서 완료)
    // ========================================
    console.log('\n=== Veo 영상화 시작 ===');

    const videoPrompt = `Animate this photo of two people into an 8-second video.

CRITICAL REQUIREMENT:
- This image shows TWO DIFFERENT PEOPLE side by side
- BOTH faces must remain EXACTLY as shown - do not change, morph, or alter either face
- The person on the LEFT and the person on the RIGHT must keep their EXACT original faces

ANIMATION:
0-2s: Both people smile and look at the camera, like posing for a selfie together
2-4s: Natural small movements - blinking, slight head tilts, breathing
4-6s: They turn to look at each other and share a laugh
6-8s: They wave at the camera and give thumbs up

STYLE:
- Candid behind-the-scenes vlog footage
- Warm, friendly atmosphere
- Natural lighting
- Slight camera movement for realism

FORBIDDEN:
❌ Do NOT change or morph any faces
❌ Do NOT blend the two faces together
❌ Do NOT alter facial features
❌ Do NOT change skin tones
❌ The two people must remain as two distinct individuals

Both faces must remain 100% identical to the input image throughout the entire video!`;

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
            bytesBase64Encoded: compositeData.base64,
            mimeType: compositeData.mimeType,
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
      message: '영상 생성 중',
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
