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

    const movieInfo = getMovieInfo(movie);

    console.log('=== PhotoMaker 합성 → Veo 영상 ===');
    console.log('Movie:', movieInfo.koreanTitle);

    // ========================================
    // STEP 1: PhotoMaker로 합성 이미지 생성
    // 사용자 얼굴을 100% 보존하면서 배우들과 함께 있는 이미지
    // ========================================
    console.log('\n=== STEP 1: PhotoMaker 합성 ===');

    const photoMakerPrompt = buildPhotoMakerPrompt(movieInfo);
    console.log('Prompt:', photoMakerPrompt);

    // PhotoMaker 실행 - 사용자 얼굴 보존
    let compositeImageUrl;
    try {
      const output = await replicate.run(
        "tencentarc/photomaker:ddfc2b08d209f9fa8c1uj00000gn/tencentarc/photomaker-style:467d062309da518648ba89d226490e02b8ed09b5abc15026e54e31c5a8cd0769",
        {
          input: {
            input_image: imageUrl,
            prompt: photoMakerPrompt,
            style_name: "Photographic (Default)",
            negative_prompt: "nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, cropped, worst quality, low quality, jpeg artifacts, watermark, blurry, deformed face, ugly",
            num_steps: 50,
            style_strength_ratio: 20,
            num_outputs: 1,
            guidance_scale: 5,
          }
        }
      );
      
      compositeImageUrl = Array.isArray(output) ? output[0] : output;
      console.log('PhotoMaker 완료:', compositeImageUrl);
    } catch (photoMakerError) {
      console.error('PhotoMaker 실패:', photoMakerError.message);
      
      // PhotoMaker 실패 시 face-to-many 시도
      console.log('face-to-many 시도...');
      try {
        const output = await replicate.run(
          "fofr/face-to-many:a07f252abbbd832009640b27f063ea52d87d7a23a185ca165bec23b5adc8deaf",
          {
            input: {
              image: imageUrl,
              style: "3D",
              prompt: photoMakerPrompt,
              negative_prompt: "ugly, deformed",
              prompt_strength: 4.5,
              denoising_strength: 0.65,
              instant_id_strength: 0.8,
            }
          }
        );
        compositeImageUrl = Array.isArray(output) ? output[0] : output;
        console.log('face-to-many 완료:', compositeImageUrl);
      } catch (faceToManyError) {
        console.error('face-to-many도 실패:', faceToManyError.message);
        
        // 최후의 수단: pulid 사용
        console.log('PuLID 시도...');
        const output = await replicate.run(
          "zsxkib/pulid:43d309c37ab4e62361e5e29b8e9e867fb2dcbcec77ae91206a8d95ac5dd451a0",
          {
            input: {
              main_face_image: imageUrl,
              prompt: `a photo of a person taking selfie with movie stars on a film set, ${movieInfo.background}, highly detailed, photorealistic`,
              negative_prompt: "ugly, deformed, blurry",
              num_inference_steps: 20,
              guidance_scale: 7,
            }
          }
        );
        compositeImageUrl = Array.isArray(output) ? output[0] : output;
        console.log('PuLID 완료:', compositeImageUrl);
      }
    }

    if (!compositeImageUrl) {
      return res.status(500).json({ error: '이미지 합성 실패' });
    }

    // ========================================
    // STEP 2: 합성 이미지를 Base64로 변환
    // ========================================
    console.log('\n=== 이미지 다운로드 ===');
    
    const imageResponse = await fetch(compositeImageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const compositeImageBase64 = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageResponse.headers.get('content-type') || 'image/png';
    
    console.log('이미지 다운로드 완료, length:', compositeImageBase64.length);

    // ========================================
    // STEP 3: Veo로 영상 생성 - 이미지 움직이게만!
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

    // Veo 프롬프트 - 단순히 움직이게만!
    const videoPrompt = `Animate this group photo into a natural 8 second video.

CRITICAL: Keep ALL faces EXACTLY the same as in the image. Do not change or morph any face.

Simple animation:
- Everyone smiles and poses for selfie (0-3 sec)
- Small natural movements - nodding, laughing (3-6 sec)  
- Wave goodbye (6-8 sec)

Style: Natural, candid, behind-the-scenes feel. Slight camera movement.

DO NOT change any faces!`;

    console.log('Video Prompt:', videoPrompt.substring(0, 100) + '...');

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
      message: '합성 이미지 → Veo 영상 생성 시작',
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
      actors: 'Iron Man (Robert Downey Jr.) and Captain America (Chris Evans)',
      background: 'Avengers movie set with superhero props',
    },
    spiderman: {
      koreanTitle: '스파이더맨',
      actors: 'Spider-Man (Tom Holland) and MJ (Zendaya)',
      background: 'Spider-Man movie set in New York',
    },
    harrypotter: {
      koreanTitle: '해리포터',
      actors: 'Harry Potter (Daniel Radcliffe) and Hermione (Emma Watson)',
      background: 'Hogwarts Great Hall with floating candles',
    },
    lotr: {
      koreanTitle: '반지의 제왕',
      actors: 'Gandalf (Ian McKellen) and Aragorn (Viggo Mortensen)',
      background: 'Middle-earth fantasy movie set',
    },
    starwars: {
      koreanTitle: '스타워즈',
      actors: 'Luke Skywalker and Princess Leia',
      background: 'Star Wars set with Millennium Falcon',
    },
    jurassic: {
      koreanTitle: '쥬라기 공원',
      actors: 'Dr. Alan Grant and Dr. Ian Malcolm (Jeff Goldblum)',
      background: 'Jurassic Park set with dinosaurs',
    },
  };
  return settings[movie] || settings.avengers;
}

function buildPhotoMakerPrompt(movieInfo) {
  return `img, a photo of a person taking a group selfie with ${movieInfo.actors} on a ${movieInfo.background}, everyone smiling at camera, friendly warm atmosphere, photorealistic, high quality, 4K`;
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: false,
  },
};
