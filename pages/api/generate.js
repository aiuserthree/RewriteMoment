import { GoogleAuth } from 'google-auth-library';
import Replicate from 'replicate';

// Google Cloud 설정
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'rewritemoment';
const LOCATION = 'us-central1';

const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON 
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : null;

// Replicate
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

    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: 'REPLICATE_API_TOKEN not configured' });
    }

    const movieInfo = getMovieInfo(movie);

    console.log('=== 얼굴 합성 → Veo 영상 ===');
    console.log('Movie:', movieInfo.koreanTitle);

    // ========================================
    // STEP 1: InstantID로 합성 이미지 생성
    // 사용자 얼굴을 보존하면서 배우들과 함께 있는 이미지
    // ========================================
    console.log('\n=== STEP 1: InstantID 합성 ===');

    const prompt = `a photo of a person taking a group selfie with famous movie actors ${movieInfo.actors} on ${movieInfo.background}, everyone smiling at camera, friendly atmosphere, highly detailed, photorealistic, 8k`;

    console.log('Prompt:', prompt);
    console.log('Image URL length:', imageUrl.length);

    let compositeImageUrl;
    
    try {
      // InstantID 사용
      console.log('Running InstantID...');
      const output = await replicate.run(
        "zsxkib/instant-id:6af8583c541261472e92155d87bba80d5ad98461665802c6d0a9d5f1a97f80fe",
        {
          input: {
            image: imageUrl,
            prompt: prompt,
            negative_prompt: "ugly, deformed, blurry, bad anatomy, bad face, wrong face, multiple faces",
            num_inference_steps: 30,
            guidance_scale: 5,
            ip_adapter_scale: 0.8,
            controlnet_conditioning_scale: 0.8,
          }
        }
      );
      
      compositeImageUrl = Array.isArray(output) ? output[0] : output;
      console.log('InstantID 완료:', compositeImageUrl?.substring(0, 100));
      
    } catch (instantIdError) {
      console.error('InstantID 에러:', instantIdError.message);
      
      // 백업: face-to-many 시도
      try {
        console.log('face-to-many 시도...');
        const output = await replicate.run(
          "fofr/face-to-many:a07f252abbbd832009640b27f063ea52d87d7a23a185ca165bec23b5adc8deaf",
          {
            input: {
              image: imageUrl,
              style: "Video game",
              prompt: prompt,
              negative_prompt: "ugly, deformed",
              prompt_strength: 4.5,
              denoising_strength: 0.65,
              instant_id_strength: 0.8,
            }
          }
        );
        compositeImageUrl = Array.isArray(output) ? output[0] : output;
        console.log('face-to-many 완료:', compositeImageUrl?.substring(0, 100));
      } catch (faceError) {
        console.error('face-to-many도 실패:', faceError.message);
        return res.status(500).json({ 
          error: '이미지 합성 실패', 
          details: faceError.message 
        });
      }
    }

    if (!compositeImageUrl) {
      return res.status(500).json({ error: '합성 이미지 URL이 없음' });
    }

    // ========================================
    // STEP 2: 합성 이미지를 Base64로 변환
    // ========================================
    console.log('\n=== 이미지 다운로드 ===');
    
    const imageResponse = await fetch(compositeImageUrl);
    if (!imageResponse.ok) {
      return res.status(500).json({ error: '합성 이미지 다운로드 실패' });
    }
    
    const imageBuffer = await imageResponse.arrayBuffer();
    const compositeImageBase64 = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageResponse.headers.get('content-type') || 'image/png';
    
    console.log('이미지 다운로드 완료, length:', compositeImageBase64.length);

    // ========================================
    // STEP 3: Veo로 영상 생성
    // ========================================
    console.log('\n=== STEP 2: Veo 영상화 ===');

    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    const videoPrompt = `Animate this group selfie photo into a natural 8 second video.

IMPORTANT: Keep ALL faces exactly the same. Do not change any face.

Animation:
- 0-3 sec: Everyone poses for selfie, smiling at camera
- 3-6 sec: Natural movements, laughing, chatting
- 6-8 sec: Wave goodbye

Style: Candid behind-the-scenes vlog feel, warm atmosphere, slight camera shake.

DO NOT morph or change any faces!`;

    console.log('Calling Veo...');

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
            mimeType: mimeType,
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
      return res.status(500).json({ error: 'Veo 실패', details: veoData.error?.message });
    }

    console.log('Veo 시작:', veoData.name);

    return res.status(200).json({
      id: veoData.name,
      status: 'processing',
      message: '합성 완료 → 영상 생성 중',
      provider: 'google-veo',
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: '영상 생성 실패', details: error.message });
  }
}

function getMovieInfo(movie) {
  const settings = {
    avengers: {
      koreanTitle: '어벤저스',
      actors: 'Iron Man in red gold suit and Captain America in blue uniform',
      background: 'Avengers movie set with superhero props and studio lights',
    },
    spiderman: {
      koreanTitle: '스파이더맨',
      actors: 'Spider-Man in red blue suit and MJ',
      background: 'Spider-Man movie set with New York backdrop',
    },
    harrypotter: {
      koreanTitle: '해리포터',
      actors: 'Harry Potter with glasses and Hermione in Hogwarts robes',
      background: 'Hogwarts Great Hall with floating candles',
    },
    lotr: {
      koreanTitle: '반지의 제왕',
      actors: 'Gandalf the wizard and Aragorn the ranger',
      background: 'Middle-earth fantasy movie set',
    },
    starwars: {
      koreanTitle: '스타워즈',
      actors: 'Luke Skywalker with lightsaber and Princess Leia',
      background: 'Star Wars set with Millennium Falcon',
    },
    jurassic: {
      koreanTitle: '쥬라기 공원',
      actors: 'Dr. Alan Grant and Dr. Ian Malcolm',
      background: 'Jurassic Park set with dinosaur props',
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
