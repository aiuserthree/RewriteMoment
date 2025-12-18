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
      mode = 'quick', // quick, story, trailer
      rewriteText,    // Optional rewrite moment text
      stage,          // teen, twenties, newlywed, early_parenting
      genre,          // docu, comedy, drama, melo, fantasy
      distance,       // symbolic, similar, quite_similar
      ending,         // recovery, growth, reconcile, self_protect, new_start, comedy
      sliders,        // { realism, intensity, pace }
      clipType = 'main',  // 클립 타입: main, opening, climax, hook, rising, ending
      clipIndex = 0,      // 현재 클립 인덱스
      totalClips = 1,     // 총 클립 수
    } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image is required' });
    }

    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    // Build comprehensive prompt based on all selections
    const fullPrompt = buildPrompt({ 
      rewriteText, 
      stage, 
      genre, 
      mode,
      distance,
      ending,
      sliders: sliders || { realism: 60, intensity: 40, pace: 70 },
      clipType,
      clipIndex,
      totalClips,
    });

    console.log('=== Veo 3.1 Video Generation ===');
    console.log('Aspect Ratio:', aspectRatio);
    console.log('Stage:', stage);
    console.log('Genre:', genre);
    console.log('Mode:', mode);
    console.log('Clip:', `${clipIndex + 1}/${totalClips} (${clipType})`);
    console.log('Rewrite:', rewriteText ? 'Yes' : 'No');
    console.log('Prompt:', fullPrompt.substring(0, 200) + '...');
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
    console.log('Image Base64 preview:', imageBase64?.substring(0, 50) + '...');

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
      message: 'Video generation started with Veo 3.1',
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

// Build comprehensive prompt based on all user selections
function buildPrompt({ rewriteText, stage, genre, mode, distance, ending, sliders, clipType = 'main', clipIndex = 0, totalClips = 1 }) {
  
  // 라이프 스테이지별 상세 설정 (한국 배경)
  // Note: Veo prohibits minors, so "teen" uses young adult students
  const stageSettings = {
    teen: {
      people: 'The person from the image as a young Korean university student in early 20s',
      clothes: 'wearing a Korean school uniform blazer with white shirt, or casual campus fashion (hoodie, jeans)',
      location: 'inside a bright Korean high school classroom with green chalkboard, wooden desks, or university campus corridor',
      background: 'Korean educational posters on walls, window showing cherry blossom trees, fluorescent lights',
    },
    twenties: {
      people: 'The person from the image as a trendy Korean young adult in their 20s',
      clothes: 'wearing stylish K-fashion (oversized blazer, wide pants, minimal aesthetic Korean style)',
      location: 'at a modern Korean cafe with aesthetic interior, or busy Seoul street with neon signs',
      background: 'Iced Americano on table, MacBook, Korean signs in background, Hongdae or Gangnam atmosphere',
    },
    newlywed: {
      people: 'The person from the image as a young Korean adult in late 20s',
      clothes: 'wearing comfortable home clothes (matching loungewear, cardigan)',
      location: 'in a cozy modern Korean apartment living room with warm lighting',
      background: 'Wedding photo frames on shelf, Korean home decor, TV, plants, warm wooden interior',
    },
    early_parenting: {
      people: 'The person from the image as a Korean parent in their 30s',
      clothes: 'wearing casual comfortable clothes (soft cardigan, cotton pants)',
      location: 'in a warm Korean family apartment with colorful play mat on floor',
      background: 'Baby toys scattered around, family photos on wall, soft cushions, warm atmosphere',
    },
  };

  // 장르별 구체적 행동과 스타일
  const genreActions = {
    docu: {
      action: 'Looking directly at camera with sincere expression, then turning to look out the window thoughtfully, natural candid movements',
      movement: 'subtle head turns, natural eye blinks, slight smile forming',
      style: 'documentary realism, natural lighting from window, handheld camera subtle shake',
      emotion: 'authentic, reflective, contemplative, real-life moment',
    },
    comedy: {
      action: 'Making a surprised funny face, then bursting into laughter, playful gestures, animated expressions',
      movement: 'exaggerated reactions, throwing head back laughing, clapping hands, covering mouth while giggling',
      style: 'bright colorful lighting, wide angle to capture full reactions, vibrant saturation',
      emotion: 'joyful, playful, silly, lighthearted fun',
    },
    drama: {
      action: 'Deep in thought with furrowed brow, then looking up with determined eyes, emotional intensity building',
      movement: 'slow deliberate movements, meaningful pauses, clenching fist or touching heart',
      style: 'cinematic dramatic lighting with strong shadows, shallow depth of field, rich contrast',
      emotion: 'intense, emotional, conflicted, dramatic tension',
    },
    melo: {
      action: 'Gazing softly into distance with gentle smile, touching face tenderly, looking down shyly then up again',
      movement: 'slow graceful movements, hair gently moving, soft gestures, tender expressions',
      style: 'soft golden hour glow, warm pink and orange tones, dreamy bokeh background',
      emotion: 'romantic, tender, bittersweet, heartfelt longing',
    },
    fantasy: {
      action: 'Eyes widening in wonder, reaching out hand toward magical light, spinning around in amazement',
      movement: 'flowing ethereal movements, looking around in awe, magical gestures',
      style: 'magical lighting with lens flares, sparkles and glowing particles, otherworldly colors',
      emotion: 'wonder, enchantment, magical surprise, dreamlike',
    },
  };

  // 슬라이더 값으로 세부 조정
  const realismLevel = parseInt(sliders?.realism) || 60;
  const intensityLevel = parseInt(sliders?.intensity) || 40;
  const paceLevel = parseInt(sliders?.pace) || 70;

  // 리얼리즘 수준
  const realismStyle = realismLevel < 40 
    ? 'highly stylized cinematic look, movie-like color grading' 
    : realismLevel > 70 
    ? 'ultra realistic footage, like iPhone video, natural imperfections' 
    : 'balanced cinematic realism, professional but natural';
    
  // 감정 강도
  const emotionIntensity = intensityLevel < 40 
    ? 'subtle understated emotions, minimal expression changes' 
    : intensityLevel > 70 
    ? 'intense dramatic emotions, visible tears or strong reactions' 
    : 'moderate emotional expression, relatable reactions';
    
  // 페이스/속도
  const motionPace = paceLevel < 40 
    ? 'slow motion 0.5x speed, lingering contemplative shots' 
    : paceLevel > 70 
    ? 'energetic quick movements, dynamic action' 
    : 'natural comfortable rhythm, real-time pacing';

  // 스테이지 및 장르 정보 가져오기
  const stageInfo = stageSettings[stage] || stageSettings.teen;
  const genreInfo = genreActions[genre] || genreActions.drama;

  // 클립 타입별 장면 설정 (스토리 진행에 따라 다른 장면)
  const clipScenes = {
    // 단일 클립 (Quick Pack)
    main: {
      scene: 'Main scene',
      action: genreInfo.action,
      movement: genreInfo.movement,
      narrative: 'A complete moment captured in one continuous shot',
    },
    // Story Pack (2클립) - 도입과 클라이맥스
    opening: {
      scene: 'Opening scene - establishing shot',
      action: 'Starting the day, looking around the space, settling into the environment, initial calm before events unfold',
      movement: 'slow entrance, looking around, taking in surroundings, relaxed posture',
      narrative: 'The beginning of the story, introducing the character in their environment',
    },
    climax: {
      scene: 'Climax scene - emotional peak',
      action: genreInfo.action,
      movement: genreInfo.movement,
      narrative: 'The emotional high point of the story, peak dramatic moment',
    },
    // Trailer (4클립) - Hook, Rising, Climax, Ending
    hook: {
      scene: 'Hook scene - attention grabber',
      action: 'Turning toward camera with intriguing expression, mysterious or inviting look, creating curiosity',
      movement: 'sudden turn, direct eye contact, enigmatic half-smile, leaning in',
      narrative: 'The hook that captures attention immediately',
    },
    rising: {
      scene: 'Rising action scene - building tension',
      action: 'Something unexpected happens, reacting to news or event, tension building in body language',
      movement: 'surprised reaction, hand to chest, stepping back, eyes widening',
      narrative: 'Events begin to unfold, tension rises',
    },
    ending: {
      scene: 'Ending scene - resolution',
      action: 'Finding peace, acceptance, or new determination, final emotional resolution',
      movement: 'deep breath, shoulders dropping in relief, peaceful smile, looking toward future',
      narrative: 'The resolution and conclusion of the story',
    },
  };

  const clipScene = clipScenes[clipType] || clipScenes.main;

  // 메인 프롬프트 구성 - 얼굴 보존 최우선
  let prompt = `[CRITICAL IDENTITY PRESERVATION] `;
  prompt += `The person in this video MUST have the EXACT SAME face as the input image. `;
  prompt += `Preserve identical: face shape, eyes, eyebrows, nose, lips, skin tone, facial proportions. `;
  prompt += `The face must be recognizable as the same person from start to end. `;
  prompt += `DO NOT morph, change, or alter any facial features. `;
  
  prompt += `\n\n[CHARACTER] ${stageInfo.people}, ${stageInfo.clothes}. `;
  prompt += `\n[SETTING] ${stageInfo.location}. ${stageInfo.background}. `;
  
  // 클립 타입에 따른 액션 적용
  prompt += `\n[SCENE] ${clipScene.scene}. `;
  prompt += `\n[ACTION] ${clipScene.action}. `;
  prompt += `\n[MOVEMENT] ${clipScene.movement}. `;
  prompt += `\n[NARRATIVE] ${clipScene.narrative}. `;
  
  prompt += `\n[STYLE] ${genreInfo.style}. ${genreInfo.emotion} mood. `;
  prompt += `${realismStyle}. ${emotionIntensity}. ${motionPace}. `;
  prompt += `\n[FRAMING] Close-up to medium shot, face always clearly visible and in focus. `;
  prompt += `Korean setting, Korean aesthetic. Photorealistic quality, 4K cinematic video. `;
  prompt += `Consistent lighting on face throughout.`;

  // Rewrite Moment (결말 재구성) - 마지막 클립에만 적용
  if (rewriteText && (clipType === 'ending' || clipType === 'climax' || clipType === 'main')) {
    const endingTransitions = {
      recovery: 'Scene transitions: initial sadness slowly transforms to peaceful acceptance, tears turning to gentle smile, shoulders relaxing, deep breath of relief',
      growth: 'Scene transitions: uncertainty transforms to confidence, standing taller, eyes brightening with determination, small victorious smile',
      reconcile: 'Scene transitions: hurt expression softens to understanding, extending hand in forgiveness, warm reconnecting smile',
      self_protect: 'Scene transitions: vulnerability transforms to quiet strength, setting boundaries with calm confidence, self-assured nod',
      new_start: 'Scene transitions: looking back briefly then turning forward with hope, stepping toward bright light, optimistic smile',
      comedy: 'Scene transitions: tense moment breaks into unexpected laughter, seeing humor in situation, relieved giggles',
    };
    const endingDesc = endingTransitions[ending] || endingTransitions.growth;
    prompt += ` ${endingDesc}.`;
  }

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

