import { GoogleAuth } from 'google-auth-library';

// Google Cloud 설정
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'rewritemoment';
const LOCATION = 'us-central1';

// 서비스 계정 인증 정보
const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON 
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : null;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      imageUrl,       // Base64 or URL of uploaded image (사용자 사진)
      aspectRatio = '16:9',
      movie,          // avengers, spiderman, harrypotter, lotr, starwars, jurassic
    } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image is required' });
    }

    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    // Google Auth 설정
    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // 이미지 Base64 처리 및 MIME 타입 추출
    let imageBase64 = imageUrl;
    let mimeType = 'image/jpeg';
    
    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        imageBase64 = matches[2];
      } else {
        imageBase64 = imageUrl.split(',')[1];
      }
    }

    // 영화 정보 가져오기
    const movieInfo = getMovieInfo(movie);
    
    // 영상 프롬프트 생성 - 원본 인물 + 배우들이 들어오는 장면
    const videoPrompt = buildVideoPrompt(movieInfo);

    console.log('=== Direct Veo Generation ===');
    console.log('Movie:', movie, '-', movieInfo.koreanTitle);
    console.log('Aspect Ratio:', aspectRatio);
    console.log('Image Base64 length:', imageBase64?.length || 0);
    console.log('Prompt:', videoPrompt.substring(0, 300) + '...');
    console.log('==============================');

    // Veo API 엔드포인트
    const veoEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/veo-2.0-generate-001:predictLongRunning`;

    const veoRequestBody = {
      instances: [{
        prompt: videoPrompt,
        image: {
          bytesBase64Encoded: imageBase64,
          mimeType: mimeType,
        },
      }],
      parameters: {
        aspectRatio: aspectRatio,
        sampleCount: 1,
        durationSeconds: 8,
        personGeneration: 'allow_adult',
      },
    };

    console.log('Calling Veo API...');

    const veoResponse = await fetch(veoEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(veoRequestBody),
    });

    const veoData = await veoResponse.json();

    if (!veoResponse.ok) {
      console.error('Veo API Error:', veoData);
      return res.status(veoResponse.status).json({ 
        error: 'Veo video generation failed',
        details: veoData.error?.message || JSON.stringify(veoData)
      });
    }

    console.log('Veo Response:', JSON.stringify(veoData, null, 2));

    const operationName = veoData.name;

    return res.status(200).json({
      id: operationName,
      status: 'processing',
      message: 'Video generation started',
      provider: 'google-veo'
    });

  } catch (error) {
    console.error('Generation error:', error);
    return res.status(500).json({ 
      error: 'Failed to start video generation',
      details: error.message 
    });
  }
}

// 영화 정보 가져오기
function getMovieInfo(movie) {
  const movieSettings = {
    avengers: {
      title: 'Avengers',
      koreanTitle: '어벤저스',
      actors: [
        { name: 'Tony Stark', actor: 'Robert Downey Jr.', look: 'a charismatic man with goatee wearing the red and gold Iron Man suit, arc reactor glowing on chest' },
        { name: 'Captain America', actor: 'Chris Evans', look: 'a muscular blonde man in the iconic blue Captain America suit with star on chest, holding round shield' },
        { name: 'Thor', actor: 'Chris Hemsworth', look: 'a tall muscular man with long blonde hair, red cape, Asgardian armor, holding Mjolnir hammer' },
      ],
      set: 'Avengers movie set with high-tech equipment, superhero props, green screens',
      vibe: 'exciting superhero energy',
    },
    spiderman: {
      title: 'Spider-Man',
      koreanTitle: '스파이더맨',
      actors: [
        { name: 'Spider-Man', actor: 'Tom Holland', look: 'a young friendly man in the red and blue Spider-Man suit with mask pulled off, showing his face' },
        { name: 'MJ', actor: 'Zendaya', look: 'a beautiful young woman with curly dark hair, casual style' },
      ],
      set: 'Spider-Man movie set with New York backdrop, web props',
      vibe: 'fun youthful friendly atmosphere',
    },
    harrypotter: {
      title: 'Harry Potter',
      koreanTitle: '해리포터',
      actors: [
        { name: 'Harry Potter', actor: 'Daniel Radcliffe', look: 'a young man with messy black hair, round glasses, lightning scar on forehead, Gryffindor robes, holding wand' },
        { name: 'Hermione', actor: 'Emma Watson', look: 'a young woman with wavy brown hair, intelligent expression, Gryffindor robes' },
        { name: 'Ron', actor: 'Rupert Grint', look: 'a tall young man with red hair and freckles, Gryffindor robes' },
      ],
      set: 'Hogwarts Great Hall movie set with floating candles, long tables, magical atmosphere',
      vibe: 'magical wizarding world wonder',
    },
    lotr: {
      title: 'Lord of the Rings',
      koreanTitle: '반지의 제왕',
      actors: [
        { name: 'Gandalf', actor: 'Ian McKellen', look: 'a tall elderly wizard with long grey beard, grey robes, pointed hat, wooden staff' },
        { name: 'Aragorn', actor: 'Viggo Mortensen', look: 'a rugged man with stubble and long dark hair, ranger clothes, sword at side' },
        { name: 'Legolas', actor: 'Orlando Bloom', look: 'an ethereal blonde elf with pointed ears, bow and arrows, elvish clothes' },
      ],
      set: 'Middle-earth movie set with fantasy props, New Zealand landscape',
      vibe: 'epic fantasy adventure',
    },
    starwars: {
      title: 'Star Wars',
      koreanTitle: '스타워즈',
      actors: [
        { name: 'Luke Skywalker', actor: 'Mark Hamill', look: 'a young man in tan Jedi robes, holding lightsaber with blue blade' },
        { name: 'Princess Leia', actor: 'Carrie Fisher', look: 'an elegant woman with iconic side hair buns, white robes' },
        { name: 'Han Solo', actor: 'Harrison Ford', look: 'a roguish man in white shirt and black vest, blaster at hip' },
      ],
      set: 'Star Wars movie set with Millennium Falcon, droids R2-D2 and C-3PO',
      vibe: 'galactic space opera excitement',
    },
    jurassic: {
      title: 'Jurassic Park',
      koreanTitle: '쥬라기 공원',
      actors: [
        { name: 'Dr. Grant', actor: 'Sam Neill', look: 'a rugged paleontologist in khaki clothes and hat' },
        { name: 'Dr. Malcolm', actor: 'Jeff Goldblum', look: 'a charismatic man in black leather jacket with witty expression' },
      ],
      set: 'Jurassic Park set with animatronic T-Rex dinosaur, jungle foliage, park jeeps',
      vibe: 'thrilling adventure with dinosaurs',
    },
  };

  return movieSettings[movie] || movieSettings.avengers;
}

// 영상 프롬프트 생성 - 핵심: 원본 인물 유지 + 배우들이 등장
function buildVideoPrompt(movieInfo) {
  // 배우 2명 선택
  const selectedActors = movieInfo.actors.slice(0, 2);
  
  let prompt = `[CRITICAL - READ CAREFULLY]

THIS VIDEO MUST FEATURE THE EXACT PERSON FROM THE INPUT IMAGE AS THE MAIN CHARACTER.
- The person's face from the input image MUST appear throughout the entire video
- Their face, hair, and appearance must be IDENTICAL to the input image
- They are the MAIN CHARACTER - always visible and in focus

SCENE DESCRIPTION (8 seconds):
The person from the input image is standing on a ${movieInfo.title} movie set. ${movieInfo.set}.

Then, famous actors walk INTO THE FRAME to greet them:
- ${selectedActors[0].name} (${selectedActors[0].look}) approaches from the left, smiling warmly
- ${selectedActors[1] ? `${selectedActors[1].name} (${selectedActors[1].look}) comes from the right` : ''}

SEQUENCE:
0-2 sec: The person (from input image) looks around the movie set excitedly
2-4 sec: ${selectedActors[0].name} walks up, waves hello, puts arm around them for a selfie pose
4-6 sec: They take a selfie together, both smiling at the camera${selectedActors[1] ? `, ${selectedActors[1].name} joins in` : ''}
6-8 sec: Friendly chatting, laughing together, actors wave goodbye as they walk back to set

STYLE:
- Behind-the-scenes vlog / documentary feel
- ${movieInfo.vibe}
- Natural warm lighting
- Smooth camera movement
- Genuine friendly interactions

ABSOLUTE REQUIREMENT:
The person from the input image is the STAR of this video. Their face must be clearly visible and UNCHANGED throughout. The movie actors are SUPPORTING characters who interact with them.`;

  return prompt;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false,
  },
};
