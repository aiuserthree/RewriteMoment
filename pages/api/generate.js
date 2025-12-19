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
      imageUrl,       // Base64 or URL of uploaded image
      aspectRatio = '16:9', // 16:9 (가로) or 9:16 (세로)
      movie,          // avengers, spiderman, harrypotter, lotr, starwars, jurassic
    } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image is required' });
    }

    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    // Build comprehensive prompt based on movie selection
    const fullPrompt = buildMoviePrompt(movie);

    console.log('=== Veo 2.0 Video Generation ===');
    console.log('Aspect Ratio:', aspectRatio);
    console.log('Movie:', movie);
    console.log('Prompt:', fullPrompt.substring(0, 300) + '...');
    console.log('================================');

    // Google Auth 설정
    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // 이미지 Base64 처리 및 MIME 타입 추출
    let imageBase64 = imageUrl;
    let mimeType = 'image/jpeg';  // 기본값
    
    if (imageUrl.startsWith('data:')) {
      // data:image/jpeg;base64,XXXX 형식에서 분리
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        imageBase64 = matches[2];
      } else {
        imageBase64 = imageUrl.split(',')[1];
      }
    }

    // 이미지 데이터 확인 로그
    console.log('Image MIME type:', mimeType);
    console.log('Image Base64 length:', imageBase64?.length || 0);

    // Veo API 엔드포인트 - veo-2.0-generate-001 (Image-to-Video 지원)
    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/veo-2.0-generate-001:predictLongRunning`;

    // Veo 2.0 API 호출 - Image-to-Video
    const requestBody = {
      instances: [{
        prompt: fullPrompt,
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

    console.log('Request body (without image data):', JSON.stringify({
      ...requestBody,
      instances: [{
        ...requestBody.instances[0],
        image: { mimeType, bytesBase64Length: imageBase64?.length }
      }]
    }, null, 2));

    const veoResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const veoData = await veoResponse.json();

    if (!veoResponse.ok) {
      console.error('Veo API Error:', veoData);
      return res.status(veoResponse.status).json({ 
        error: 'Veo API error',
        details: veoData.error?.message || JSON.stringify(veoData)
      });
    }

    console.log('Veo Response:', JSON.stringify(veoData, null, 2));

    // Long running operation name 반환
    const operationName = veoData.name;

    return res.status(200).json({
      id: operationName,
      status: 'processing',
      message: 'Video generation started with Veo 2.0',
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

// Build movie-based prompt for selfie with actors concept
function buildMoviePrompt(movie) {
  // 영화별 설정 - 배우들, 촬영장 배경, 의상 등
  const movieSettings = {
    avengers: {
      title: 'Avengers',
      actors: [
        { name: 'Tony Stark', look: 'charismatic man in sleek suit with arc reactor glowing, confident smirk' },
        { name: 'Steve Rogers', look: 'muscular blonde man in Captain America uniform with shield, noble expression' },
        { name: 'Thor', look: 'tall muscular man with long blonde hair, red cape, holding hammer' },
        { name: 'Natasha Romanoff', look: 'beautiful woman with red hair in black tactical suit, mysterious smile' },
      ],
      set: 'massive Avengers movie set with green screens, high-tech props, superhero costumes hanging, film crew with cameras, bright studio lights, Marvel logos visible',
      vibe: 'epic superhero blockbuster atmosphere, exciting energy',
    },
    spiderman: {
      title: 'Spider-Man',
      actors: [
        { name: 'Peter Parker', look: 'young friendly man in Spider-Man suit with mask partially off, warm smile' },
        { name: 'MJ', look: 'young woman with curly dark hair, casual cool style, playful expression' },
        { name: 'Ned Leeds', look: 'friendly young man with enthusiastic expression, casual clothes' },
      ],
      set: 'Spider-Man movie set with New York City backdrop, web props, stunt equipment, camera rigs, director chairs, production crew bustling around',
      vibe: 'fun youthful friendly atmosphere, neighborhood hero energy',
    },
    harrypotter: {
      title: 'Harry Potter',
      actors: [
        { name: 'Harry Potter', look: 'young man with round glasses, lightning scar on forehead, Gryffindor robes, holding wand' },
        { name: 'Hermione Granger', look: 'young woman with wavy brown hair, intelligent expression, Gryffindor robes' },
        { name: 'Ron Weasley', look: 'tall young man with red hair, freckles, friendly grin, Gryffindor robes' },
      ],
      set: 'magical Hogwarts movie set with floating candles, stone walls, moving portraits, owls, magical props, wands on tables, wizarding world decorations',
      vibe: 'magical enchanting cozy atmosphere, wizarding world wonder',
    },
    lotr: {
      title: 'Lord of the Rings',
      actors: [
        { name: 'Frodo Baggins', look: 'small man with curly brown hair, hobbit clothes, the One Ring on chain, kind eyes' },
        { name: 'Gandalf', look: 'tall elderly man with long grey beard, grey robes, wizard staff, wise knowing expression' },
        { name: 'Aragorn', look: 'rugged handsome man with stubble, ranger clothes, sword at side, noble bearing' },
        { name: 'Legolas', look: 'ethereal blonde man with pointed ears, elvish clothes, bow and arrows, graceful' },
      ],
      set: 'epic Middle-earth movie set with hobbit hole props, elvish architecture, medieval weapons, forest backdrop, mountains in distance, New Zealand landscape visible',
      vibe: 'epic fantasy adventure atmosphere, legendary quest energy',
    },
    starwars: {
      title: 'Star Wars',
      actors: [
        { name: 'Luke Skywalker', look: 'young man in Jedi robes, holding lightsaber with blue blade, hopeful expression' },
        { name: 'Princess Leia', look: 'elegant woman with iconic hair buns, white robes, regal but warm' },
        { name: 'Han Solo', look: 'roguish handsome man in vest, blaster at hip, cocky charming smile' },
        { name: 'Darth Vader', look: 'tall imposing figure in black armor, iconic helmet, cape flowing' },
      ],
      set: 'Star Wars movie set with Millennium Falcon prop, droids (R2-D2, C-3PO), lightsabers on props table, space backdrop, futuristic control panels, Storm Trooper helmets',
      vibe: 'galactic epic adventure atmosphere, space opera excitement',
    },
    jurassic: {
      title: 'Jurassic Park',
      actors: [
        { name: 'Dr. Alan Grant', look: 'rugged man in paleontologist outfit, safari hat, fascinated expression' },
        { name: 'Dr. Ellie Sattler', look: 'confident woman in outdoor research clothes, intelligent curious expression' },
        { name: 'Dr. Ian Malcolm', look: 'charismatic man in black leather jacket, witty knowing smirk' },
      ],
      set: 'Jurassic Park movie set with animatronic dinosaur (T-Rex) in background, jungle foliage, electric fences, Jeep vehicles, amber props, dinosaur fossils, park signs',
      vibe: 'thrilling adventure atmosphere, wonder mixed with danger',
    },
  };

  const movieInfo = movieSettings[movie] || movieSettings.avengers;
  
  // 랜덤하게 배우 2-3명 선택하여 자연스러운 시퀀스 생성
  const shuffledActors = [...movieInfo.actors].sort(() => Math.random() - 0.5);
  const selectedActors = shuffledActors.slice(0, Math.min(3, shuffledActors.length));

  // 프롬프트 구성 - 촬영장에서 배우들과 셀카 찍는 컨셉
  let prompt = `[CRITICAL IDENTITY PRESERVATION] `;
  prompt += `The main person in this video MUST have the EXACT SAME face as the input image throughout the entire video. `;
  prompt += `This person is a fan visiting the ${movieInfo.title} movie set. `;
  prompt += `Preserve identical: face shape, eyes, nose, lips, skin tone. Face must be clearly recognizable. `;
  
  prompt += `\n\n[SETTING] On a real ${movieInfo.title} movie filming set. ${movieInfo.set}. `;
  prompt += `${movieInfo.vibe}. Professional film production environment with crew members in background. `;
  
  prompt += `\n\n[SCENE SEQUENCE] A continuous 8-second video showing: `;
  prompt += `The person (from the input image) is excitedly walking through the movie set. `;
  
  // 첫 번째 배우와의 상호작용
  prompt += `They spot ${selectedActors[0].name} (${selectedActors[0].look}) and approach them with excited expression. `;
  prompt += `${selectedActors[0].name} notices them, smiles warmly and waves them over. `;
  prompt += `They stand together, the person holds up their phone for a selfie, both smile at the camera. `;
  
  // 두 번째 배우가 있다면
  if (selectedActors[1]) {
    prompt += `Then ${selectedActors[1].name} (${selectedActors[1].look}) walks over to join, putting arm around them for another selfie. `;
    prompt += `Quick selfie together with happy expressions. `;
  }
  
  // 세 번째 배우가 있다면
  if (selectedActors[2]) {
    prompt += `${selectedActors[2].name} (${selectedActors[2].look}) waves from nearby, the person waves back excitedly. `;
  }
  
  prompt += `The actors give friendly waves goodbye as they return to filming. The person looks thrilled, waving back. `;
  
  prompt += `\n\n[CAMERA] Smooth handheld following shot, selfie POV moments when taking photos. `;
  prompt += `Natural lighting from studio lights. The person's face clearly visible throughout. `;
  prompt += `\n[STYLE] Realistic documentary style, like a behind-the-scenes vlog. Natural candid moments. `;
  prompt += `4K quality, cinematic but natural. Warm friendly atmosphere.`;

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
