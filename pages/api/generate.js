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
      mode = 'quick', // quick, story, trailer
      rewriteText,    // Optional rewrite moment text
      stage,          // teen, twenties, newlywed, early_parenting
      genre,          // docu, comedy, drama, melo, fantasy
      distance,       // symbolic, similar, quite_similar
      ending,         // recovery, growth, reconcile, self_protect, new_start, comedy
      sliders,        // { realism, intensity, pace }
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
      sliders: sliders || { realism: 60, intensity: 40, pace: 70 }
    });

    console.log('=== Veo 3.1 Video Generation ===');
    console.log('Stage:', stage);
    console.log('Genre:', genre);
    console.log('Mode:', mode);
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

    // Veo API 엔드포인트
    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/veo-3.0-generate-preview:predictLongRunning`;

    // Veo API 호출 - Image-to-Video with Start Frame
    const veoResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{
          prompt: fullPrompt,
          image: {
            bytesBase64Encoded: imageBase64,
            mimeType: mimeType,
          },
        }],
        parameters: {
          aspectRatio: '16:9',
          sampleCount: 1,
          durationSeconds: 8,  // 지원: 4, 6, 8초
          personGeneration: 'allow_adult',
          enhancePrompt: true,
        },
      }),
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
function buildPrompt({ rewriteText, stage, genre, mode, distance, ending, sliders }) {
  
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

  // 메인 프롬프트 구성 - 얼굴 보존 강조
  let prompt = `IMPORTANT: Keep the exact face from the input image throughout the video. `;
  prompt += `${stageInfo.people}, ${stageInfo.clothes}. `;
  prompt += `Setting: ${stageInfo.location}. ${stageInfo.background}. `;
  prompt += `Action: ${genreInfo.action}. Movement: ${genreInfo.movement}. `;
  prompt += `Visual style: ${genreInfo.style}. Emotional tone: ${genreInfo.emotion}. `;
  prompt += `${realismStyle}. ${emotionIntensity}. ${motionPace}. `;
  prompt += `Medium shot framing showing face and upper body clearly. Korean setting, Korean aesthetic. High quality 4K cinematic video.`;

  // Rewrite Moment (결말 재구성) 추가
  if (rewriteText) {
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

