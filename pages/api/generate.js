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

    // 영상 프롬프트 - 사용자 얼굴 보존 + 배우 등장
    const videoPrompt = `Create an 8-second cinematic video.

MAIN CHARACTER: The person shown in this photo is the MAIN CHARACTER. Their face, hair, skin tone, and all features must remain EXACTLY identical throughout the entire video. Do NOT change, morph, or alter their appearance in any way.

SCENE:
The main character (from the photo) is visiting ${movieInfo.background}.

${movieInfo.actorEntrance}

ACTION SEQUENCE:
0-2 sec: The main character holds up phone for selfie, looking at camera
2-4 sec: ${movieInfo.actors} walk into frame from behind, joining the selfie
4-6 sec: Everyone poses together - the actors put arms around the main character
6-8 sec: Natural laughter and high-fives, actors wave goodbye

CRITICAL REQUIREMENTS:
1. The main character's face from the photo MUST stay 100% identical - same eyes, nose, mouth, skin
2. ${movieInfo.actorLooks}
3. Cinematic movie quality, warm natural lighting
4. Behind-the-scenes documentary style, slight handheld camera movement

The main character should be clearly visible in the CENTER of the frame throughout.`;

    console.log('Video prompt length:', videoPrompt.length);

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
      background: 'the Avengers movie set at Stark Tower, with Iron Man suits displayed on racks, high-tech holographic screens, professional film crew in background',
      actors: 'Tony Stark (Robert Downey Jr.) and Steve Rogers (Chris Evans)',
      actorEntrance: 'Robert Downey Jr. as Tony Stark wearing his signature red and gold Iron Man suit (goatee beard, confident smile) and Chris Evans as Steve Rogers Captain America (tall blonde, muscular, blue suit with white star, carrying shield) approach from behind.',
      actorLooks: 'Tony Stark must look like Robert Downey Jr. - dark hair with grey streaks, goatee beard, brown eyes, charming smirk. Steve Rogers must look like Chris Evans - blonde hair, blue eyes, square jaw, clean-shaven, very muscular.',
    },
    spiderman: {
      koreanTitle: '스파이더맨',
      background: 'the Spider-Man movie set with New York City Queens backdrop, apartment building rooftop',
      actors: 'Peter Parker (Tom Holland) and MJ (Zendaya)',
      actorEntrance: 'Tom Holland as Peter Parker Spider-Man (young, brown wavy hair, boyish face, red-blue suit with mask off) and Zendaya as MJ (curly dark hair, natural beauty) approach from behind.',
      actorLooks: 'Peter Parker must look like Tom Holland - young face, brown wavy hair, big expressive brown eyes, friendly smile. MJ must look like Zendaya - beautiful, curly dark brown hair, elegant features.',
    },
    harrypotter: {
      koreanTitle: '해리포터',
      background: 'the Hogwarts Great Hall movie set with floating candles, long wooden tables, enchanted ceiling showing starry night',
      actors: 'Harry Potter (Daniel Radcliffe) and Hermione (Emma Watson)',
      actorEntrance: 'Daniel Radcliffe as Harry Potter (messy black hair, round glasses, lightning scar, Gryffindor robes) and Emma Watson as Hermione Granger (wavy brown hair, intelligent expression, Hogwarts robes) approach from behind.',
      actorLooks: 'Harry Potter must look like Daniel Radcliffe - messy black hair, round wire glasses, green eyes, lightning bolt scar on forehead. Hermione must look like Emma Watson - wavy light brown hair, brown eyes, refined features.',
    },
    lotr: {
      koreanTitle: '반지의 제왕',
      background: 'the Lord of the Rings movie set in Rivendell with elven architecture, waterfalls, mystical forest of New Zealand',
      actors: 'Gandalf (Ian McKellen) and Aragorn (Viggo Mortensen)',
      actorEntrance: 'Ian McKellen as Gandalf the Grey (long grey hair and beard, pointed hat, grey robes, wooden staff) and Viggo Mortensen as Aragorn (rugged, dark shoulder-length hair, stubble, ranger clothes) approach from behind.',
      actorLooks: 'Gandalf must look like Ian McKellen - elderly, long grey hair, full grey beard, wise kind eyes. Aragorn must look like Viggo Mortensen - handsome rugged face, dark hair to shoulders, light stubble beard.',
    },
    starwars: {
      koreanTitle: '스타워즈',
      background: 'the Star Wars movie set inside Millennium Falcon with cockpit controls, droids R2-D2 and C-3PO visible',
      actors: 'Luke Skywalker (Mark Hamill) and Princess Leia (Carrie Fisher)',
      actorEntrance: 'Mark Hamill as Luke Skywalker (sandy blonde hair, blue eyes, tan Jedi robes, blue lightsaber) and Carrie Fisher as Princess Leia (iconic side bun hairstyle, white flowing robes) approach from behind.',
      actorLooks: 'Luke must look like young Mark Hamill - sandy blonde hair, bright blue eyes, youthful heroic face. Leia must look like young Carrie Fisher - brown hair in side buns, brown eyes, regal elegant beauty.',
    },
    jurassic: {
      koreanTitle: '쥬라기 공원',
      background: 'the Jurassic Park movie set with animatronic T-Rex dinosaur visible, tropical jungle plants, iconic park gates',
      actors: 'Dr. Alan Grant (Sam Neill) and Dr. Ian Malcolm (Jeff Goldblum)',
      actorEntrance: 'Sam Neill as Dr. Alan Grant (khaki outfit, wide-brimmed hat, rugged paleontologist look) and Jeff Goldblum as Dr. Ian Malcolm (all black clothes, leather jacket, quirky intellectual vibe) approach from behind.',
      actorLooks: 'Alan Grant must look like Sam Neill - weathered handsome face, brown hair. Ian Malcolm must look like Jeff Goldblum - tall, dark curly hair, black leather jacket, signature eccentric charm.',
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
