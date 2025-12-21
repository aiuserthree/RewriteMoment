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
    const { imageUrl, aspectRatio = '16:9', movie } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image is required' });
    }

    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    const movieInfo = getMovieInfo(movie);

    console.log('=== Veo 영상 생성 ===');
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

    // Google Auth
    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // 프롬프트 - 사용자 얼굴 절대 보존!
    const videoPrompt = `Animate this exact photo into an 8-second video.

THE PERSON IN THIS PHOTO IS THE STAR. DO NOT CHANGE THEIR FACE AT ALL.
- Keep their exact face shape
- Keep their exact eyes, nose, mouth
- Keep their exact skin tone
- Keep their exact hair
- Keep their exact clothing

ANIMATION:
This person is on ${movieInfo.background}.
They are holding up their phone taking a selfie video.

0-2 sec: They smile and wave at the camera
2-4 sec: ${movieInfo.actors} walk up behind them and join the frame
4-6 sec: Everyone poses together for a group photo, arms around each other
6-8 sec: They all laugh, high-five, and wave goodbye

The person from this photo must be in the CENTER and CLEARLY VISIBLE the entire time.
Their face must look EXACTLY like in this input photo - do not generate a different face.

Style: Candid vlog footage, natural warm lighting, slight camera shake.`;

    console.log('Prompt ready, length:', videoPrompt.length);

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
            bytesBase64Encoded: userImageBase64,
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
      background: 'the Avengers movie set with Iron Man suits on display and high-tech screens',
      actors: 'Two actors in superhero costumes - one in a red and gold Iron Man suit (like Robert Downey Jr with goatee), one in a blue Captain America suit with shield (like Chris Evans, blonde muscular)',
    },
    spiderman: {
      koreanTitle: '스파이더맨',
      background: 'the Spider-Man movie set with New York City backdrop',
      actors: 'Two actors - a young man in red-blue Spider-Man suit (like Tom Holland), and a young woman with curly hair (like Zendaya)',
    },
    harrypotter: {
      koreanTitle: '해리포터',
      background: 'the Hogwarts Great Hall movie set with floating candles',
      actors: 'Two actors in Hogwarts robes - a young man with round glasses and messy black hair (like Daniel Radcliffe as Harry), a young woman with wavy brown hair (like Emma Watson as Hermione)',
    },
    lotr: {
      koreanTitle: '반지의 제왕',
      background: 'the Lord of the Rings Rivendell movie set with elven architecture',
      actors: 'Two actors - an elderly man with long grey beard and wizard hat (like Ian McKellen as Gandalf), a rugged man with dark hair and sword (like Viggo Mortensen as Aragorn)',
    },
    starwars: {
      koreanTitle: '스타워즈',
      background: 'the Star Wars movie set inside the Millennium Falcon cockpit',
      actors: 'Two actors - a young man in Jedi robes with lightsaber (like Mark Hamill as Luke), a woman with side-bun hairstyle in white robes (like Carrie Fisher as Leia)',
    },
    jurassic: {
      koreanTitle: '쥬라기 공원',
      background: 'the Jurassic Park movie set with dinosaur props and jungle',
      actors: 'Two actors - a man in khaki paleontologist clothes with hat (like Sam Neill), a tall man in black leather jacket (like Jeff Goldblum)',
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
