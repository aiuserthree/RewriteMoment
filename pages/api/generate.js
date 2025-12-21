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

    if (!process.env.REPLICATE_API_TOKEN) {
      console.error('REPLICATE_API_TOKEN is not set');
      return res.status(500).json({ error: 'Replicate API token not configured' });
    }

    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    const movieInfo = getMovieInfo(movie);

    console.log('=== IP-Adapter 합성 → Veo 영상 ===');
    console.log('Movie:', movieInfo.koreanTitle);
    console.log('Replicate token exists:', !!process.env.REPLICATE_API_TOKEN);

    // ========================================
    // STEP 1: IP-Adapter FaceID Plus로 합성
    // 사용자 얼굴을 정확히 보존하면서 새로운 장면 생성
    // ========================================
    console.log('\n=== STEP 1: IP-Adapter 얼굴 합성 ===');

    const prompt = `A high quality photo of a person standing with ${movieInfo.actors}, taking a group selfie together on ${movieInfo.background}. Everyone is smiling warmly at the camera. The person in the center has their phone raised for a selfie. Photorealistic, high detail, natural lighting, 8k quality.`;

    console.log('Prompt:', prompt);

    let compositeImageUrl;

    try {
      // IP-Adapter FaceID Plus V2 - 얼굴 보존에 최적화
      console.log('Running IP-Adapter FaceID...');
      const output = await replicate.run(
        "lucataco/ip-adapter-faceid-plusv2:3c1f19d108ce7c0f09c6cf8ec76afe1a93c6823cb8dee0f23c9e1c0c75c1d2e0",
        {
          input: {
            image: imageUrl,
            prompt: prompt,
            negative_prompt: "ugly, deformed, blurry, bad anatomy, bad proportions, extra limbs, cloned face, disfigured, gross proportions, malformed limbs, missing arms, missing legs, extra arms, extra legs, mutated hands, fused fingers, too many fingers, long neck, low quality, worst quality",
            num_outputs: 1,
            num_inference_steps: 30,
            guidance_scale: 7.5,
            ip_adapter_scale: 0.6,
            seed: Math.floor(Math.random() * 1000000),
          }
        }
      );

      compositeImageUrl = Array.isArray(output) ? output[0] : output;
      console.log('IP-Adapter 완료:', typeof compositeImageUrl, compositeImageUrl?.substring?.(0, 80));

    } catch (ipAdapterError) {
      console.error('IP-Adapter 실패:', ipAdapterError.message);

      // 백업: face-to-sticker (더 안정적)
      try {
        console.log('face-to-sticker 시도...');
        const output = await replicate.run(
          "fofr/face-to-sticker:764d4827ea159608a07cdde8ddf1c6000019627571f37b111e2e17e1d8957613",
          {
            input: {
              image: imageUrl,
              prompt: `${prompt}, sticker style`,
              negative_prompt: "ugly, deformed",
              steps: 20,
              width: 1024,
              height: 1024,
              ip_adapter_noise: 0.5,
              ip_adapter_weight: 0.2,
              instant_id_strength: 0.7,
            }
          }
        );
        compositeImageUrl = Array.isArray(output) ? output[0] : output;
        console.log('face-to-sticker 완료');
      } catch (stickerError) {
        console.error('face-to-sticker도 실패:', stickerError.message);
        return res.status(500).json({ 
          error: '이미지 합성 실패',
          details: stickerError.message
        });
      }
    }

    if (!compositeImageUrl) {
      return res.status(500).json({ error: '합성 이미지 생성 실패' });
    }

    // ========================================
    // STEP 2: 합성 이미지 다운로드
    // ========================================
    console.log('\n=== 이미지 다운로드 ===');

    const imageResponse = await fetch(compositeImageUrl);
    if (!imageResponse.ok) {
      console.error('이미지 다운로드 실패:', imageResponse.status);
      return res.status(500).json({ error: '합성 이미지 다운로드 실패' });
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const compositeImageBase64 = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageResponse.headers.get('content-type') || 'image/png';

    console.log('이미지 다운로드 완료, size:', compositeImageBase64.length);

    // ========================================
    // STEP 3: Veo로 영상 생성
    // ========================================
    console.log('\n=== STEP 2: Veo 영상 생성 ===');

    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    const videoPrompt = `Animate this group photo into a natural 8-second video.

CRITICAL: All faces must stay EXACTLY the same throughout the video. Do not morph or change any face.

Animation sequence:
0-2 sec: Everyone poses for the selfie, smiling at camera
2-4 sec: Small natural movements, someone tells a joke
4-6 sec: Everyone laughs naturally, high-fives
6-8 sec: The movie stars wave goodbye warmly

Style: Behind-the-scenes documentary feel, natural candid moments, warm lighting, slight handheld camera movement.

IMPORTANT: Keep all faces identical to the input image!`;

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

function getMovieInfo(movie) {
  const settings = {
    avengers: {
      koreanTitle: '어벤저스',
      actors: 'Tony Stark (Robert Downey Jr. in his iconic red and gold Iron Man suit with glowing arc reactor) and Steve Rogers (Chris Evans as Captain America in blue suit with white star, holding his vibranium shield)',
      background: 'the Avengers movie set with high-tech Stark Industries lab equipment, superhero costumes on display racks, professional studio lighting',
    },
    spiderman: {
      koreanTitle: '스파이더맨',
      actors: 'Peter Parker (Tom Holland in his red and blue Spider-Man suit with mask pulled back showing his young friendly face) and MJ (Zendaya with her curly hair and casual style)',
      background: 'the Spider-Man movie set with New York City skyline backdrop, web-shooting props',
    },
    harrypotter: {
      koreanTitle: '해리포터',
      actors: 'Harry Potter (Daniel Radcliffe with messy black hair, round glasses, lightning bolt scar, wearing Gryffindor robes) and Hermione Granger (Emma Watson with wavy brown hair in Hogwarts robes)',
      background: 'the magical Hogwarts Great Hall movie set with floating candles, long house tables, enchanted ceiling',
    },
    lotr: {
      koreanTitle: '반지의 제왕',
      actors: 'Gandalf (Ian McKellen with long grey beard, grey wizard robes, tall pointed hat, wooden staff) and Aragorn (Viggo Mortensen with rugged look, stubble, ranger clothes, sword)',
      background: 'the Lord of the Rings movie set in New Zealand with elven Rivendell architecture, waterfalls, mystical forest',
    },
    starwars: {
      koreanTitle: '스타워즈',
      actors: 'Luke Skywalker (Mark Hamill in tan Jedi robes holding glowing blue lightsaber) and Princess Leia (Carrie Fisher with iconic side hair buns, white flowing robes)',
      background: 'the Star Wars movie set with Millennium Falcon cockpit, R2-D2 and C-3PO droids, holographic displays',
    },
    jurassic: {
      koreanTitle: '쥬라기 공원',
      actors: 'Dr. Alan Grant (Sam Neill in khaki paleontologist outfit with wide-brimmed hat) and Dr. Ian Malcolm (Jeff Goldblum in black leather jacket with his signature witty expression)',
      background: 'the Jurassic Park movie set with animatronic T-Rex dinosaur, tropical jungle foliage, iconic park gates',
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
