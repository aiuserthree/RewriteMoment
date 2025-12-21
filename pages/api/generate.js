import { GoogleAuth } from 'google-auth-library';
import Replicate from 'replicate';

// Google Cloud 설정
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'rewritemoment';
const LOCATION = 'us-central1';

const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON 
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : null;

// Replicate 클라이언트
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageUrl, aspectRatio = '16:9', movie } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image is required' });
    }

    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    const movieInfo = getMovieInfo(movie);

    console.log('=== 영상 생성 시작 ===');
    console.log('Movie:', movieInfo.koreanTitle);

    // 이미지 Base64 처리
    let userImageBase64 = imageUrl;
    let mimeType = 'image/jpeg';
    
    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        userImageBase64 = matches[2];
      } else {
        userImageBase64 = imageUrl.split(',')[1];
      }
    }

    let finalImageBase64 = userImageBase64;
    let finalMimeType = mimeType;

    // ========================================
    // STEP 1: Replicate로 합성 시도 (선택적)
    // ========================================
    if (process.env.REPLICATE_API_TOKEN) {
      try {
        console.log('\n=== Replicate 합성 시도 ===');

        const prompt = `A photo of a person taking a group selfie with ${movieInfo.actors} on ${movieInfo.background}. Everyone smiling at camera. Photorealistic, high quality.`;

        // face-to-many 모델 사용 (더 안정적)
        const output = await replicate.run(
          "fofr/face-to-many:35cea9c3164d9fb7571e0e1a88f18b0a8feecf9d9ac7ac904de7e7b78f635254",
          {
            input: {
              image: imageUrl,
              style: "3D",
              prompt: prompt,
              lora_scale: 1,
              negative_prompt: "ugly, deformed, blurry",
              prompt_strength: 4.5,
              denoising_strength: 0.65,
              instant_id_strength: 0.8,
              control_depth_strength: 0.8,
            }
          }
        );

        const compositeUrl = Array.isArray(output) ? output[0] : output;
        console.log('Replicate 완료:', compositeUrl?.substring?.(0, 60));

        if (compositeUrl) {
          // 이미지 다운로드
          const imgRes = await fetch(compositeUrl);
          if (imgRes.ok) {
            const imgBuffer = await imgRes.arrayBuffer();
            finalImageBase64 = Buffer.from(imgBuffer).toString('base64');
            finalMimeType = imgRes.headers.get('content-type') || 'image/png';
            console.log('합성 이미지 준비 완료');
          }
        }
      } catch (repErr) {
        console.log('Replicate 실패, 원본 이미지로 진행:', repErr.message);
        // 원본 이미지로 계속 진행
      }
    }

    // ========================================
    // STEP 2: Veo로 영상 생성
    // ========================================
    console.log('\n=== Veo 영상 생성 ===');

    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    const videoPrompt = `Create an 8-second video where this person meets ${movieInfo.actors} on ${movieInfo.background}.

Scene:
- The person in the photo is taking a selfie
- ${movieInfo.actors} approach from behind
- Everyone poses together for the selfie, smiling
- Natural conversation and laughter
- At the end, everyone waves goodbye

CRITICAL: The person's face in the photo must stay EXACTLY the same. Do not change or morph faces.

Style: Behind-the-scenes vlog, candid, warm natural lighting.`;

    console.log('Video prompt ready');

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
            mimeType: finalMimeType,
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
        details: veoData.error?.message || JSON.stringify(veoData)
      });
    }

    console.log('Veo 시작:', veoData.name);

    return res.status(200).json({
      id: veoData.name,
      status: 'processing',
      message: '영상 생성 시작',
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

function getMovieInfo(movie) {
  const settings = {
    avengers: {
      koreanTitle: '어벤저스',
      actors: 'Iron Man in his red gold armor suit and Captain America in blue uniform with shield',
      background: 'an Avengers movie set with superhero props',
    },
    spiderman: {
      koreanTitle: '스파이더맨',
      actors: 'Spider-Man in red blue suit and a young woman (MJ)',
      background: 'a Spider-Man movie set with NYC backdrop',
    },
    harrypotter: {
      koreanTitle: '해리포터',
      actors: 'a wizard with round glasses (Harry) and a witch with brown hair (Hermione) in Hogwarts robes',
      background: 'the Hogwarts Great Hall movie set',
    },
    lotr: {
      koreanTitle: '반지의 제왕',
      actors: 'an old wizard with grey beard (Gandalf) and a ranger with sword (Aragorn)',
      background: 'a Middle-earth fantasy movie set',
    },
    starwars: {
      koreanTitle: '스타워즈',
      actors: 'a Jedi with lightsaber and a princess in white robes',
      background: 'a Star Wars movie set with spaceship',
    },
    jurassic: {
      koreanTitle: '쥬라기 공원',
      actors: 'a paleontologist in khaki and a scientist in black jacket',
      background: 'a Jurassic Park set with dinosaur props',
    },
  };
  return settings[movie] || settings.avengers;
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: false,
  },
};
