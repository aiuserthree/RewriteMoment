import Replicate from 'replicate';

// Remove BOM and whitespace from token
const apiToken = (process.env.REPLICATE_API_TOKEN || '').replace(/^\uFEFF/, '').trim();

const replicate = new Replicate({
  auth: apiToken,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      imageUrl,       // Base64 or URL of uploaded image (optional for text-to-video)
      mode = 'quick', // quick, story, trailer
      rewriteText,    // Optional rewrite moment text
      stage,          // teen, twenties, newlywed, early_parenting
      genre,          // docu, comedy, drama, melo, fantasy
      distance,       // symbolic, similar, quite_similar
      ending,         // recovery, growth, reconcile, self_protect, new_start, comedy
      sliders,        // { realism, intensity, pace }
    } = req.body;

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

    console.log('=== Video Generation Request ===');
    console.log('Stage:', stage);
    console.log('Genre:', genre);
    console.log('Mode:', mode);
    console.log('Rewrite:', rewriteText ? 'Yes' : 'No');
    console.log('Full Prompt:', fullPrompt);
    console.log('================================');

    // Use Minimax Video-01 with subject_reference for face preservation
    // 업로드한 얼굴을 유지하면서 새로운 장면 생성 (옷, 환경, 여러 사람 등)
    const prediction = await replicate.predictions.create({
      model: "minimax/video-01",
      input: {
        prompt: fullPrompt,
        subject_reference: imageUrl,  // 사용자 얼굴 참조
        prompt_optimizer: true,
      },
    });

    // Return prediction ID for polling
    return res.status(200).json({
      id: prediction.id,
      status: prediction.status,
      message: 'Video generation started',
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
  
  // 라이프 스테이지별 상세 설정 (한국 배경, 한국 사람)
  const stageSettings = {
    teen: {
      people: 'A group of 3-4 Korean teenage students (ages 16-18, Asian Korean faces)',
      clothes: 'wearing Korean high school uniforms (white dress shirts, navy blue blazers, plaid skirts for girls or navy slacks for boys)',
      location: 'in a bright Korean high school hallway (복도) with shoe lockers and bulletin boards',
      activity: 'walking together, laughing and chatting in Korean style, carrying backpacks',
      props: 'Korean textbooks, smartphones, school bags, Korean snacks',
    },
    twenties: {
      people: 'A group of Korean young adults in their 20s (Asian Korean faces)',
      clothes: 'wearing trendy Korean fashion (청청패션, oversized sweaters, wide pants, minimal Korean style)',
      location: 'at a stylish Korean cafe (한국 카페) with aesthetic interior, neon signs',
      activity: 'having Americano coffee, chatting, taking photos for Instagram',
      props: 'iced Americano, Korean desserts, MacBooks, AirPods',
    },
    newlywed: {
      people: 'A young Korean married couple in their late 20s (Asian Korean faces)',
      clothes: 'wearing comfortable Korean home clothes (편한 옷, matching loungewear)',
      location: 'in a modern Korean apartment (아파트) living room with warm lighting',
      activity: 'cooking Korean food together, watching TV on sofa, cozy moments',
      props: 'Korean wedding photos, rice cooker, soju glasses, Korean home decor',
    },
    early_parenting: {
      people: 'Korean parents with a toddler (age 2-3, Asian Korean family)',
      clothes: 'wearing casual Korean style clothes (편한 옷, 카디건)',
      location: 'in a warm Korean family apartment living room with play mat',
      activity: 'playing with the child, reading Korean picture books, tender family moments',
      props: 'Korean toys, baby items, family photos, Korean childrens books',
    },
  };

  // 장르별 영화 스타일
  const genreStyles = {
    docu: {
      lighting: 'natural documentary lighting, handheld camera feel',
      colors: 'muted realistic colors, desaturated tones',
      mood: 'authentic, intimate, slice-of-life',
      camera: 'close-up candid shots, observational style',
    },
    comedy: {
      lighting: 'bright even lighting, well-lit cheerful scenes',
      colors: 'vibrant saturated colors, warm cheerful palette',
      mood: 'lighthearted, playful, feel-good, funny',
      camera: 'wide shots showing reactions, comedic timing',
    },
    drama: {
      lighting: 'cinematic dramatic lighting with shadows',
      colors: 'rich deep colors, moody color grading',
      mood: 'emotional, intense, thought-provoking',
      camera: 'slow meaningful shots, dramatic angles',
    },
    melo: {
      lighting: 'soft golden hour lighting, romantic glow',
      colors: 'warm pastel tones, soft pink and orange hues',
      mood: 'tender, emotional, bittersweet, touching',
      camera: 'slow motion, intimate close-ups, lingering gazes',
    },
    fantasy: {
      lighting: 'magical ethereal lighting with lens flares',
      colors: 'vibrant otherworldly colors, magical glows',
      mood: 'dreamlike, enchanting, whimsical, wonder',
      camera: 'sweeping movements, fantastical angles',
    },
  };

  // 슬라이더 값
  const realismLevel = parseInt(sliders?.realism) || 60;
  const intensityLevel = parseInt(sliders?.intensity) || 40;
  const paceLevel = parseInt(sliders?.pace) || 70;

  // 분위기 설명
  const realismDesc = realismLevel < 40 
    ? 'highly stylized movie aesthetic' 
    : realismLevel > 70 
    ? 'ultra realistic, like real footage' 
    : 'cinematic but natural';
    
  const intensityDesc = intensityLevel < 40 
    ? 'subtle gentle emotions' 
    : intensityLevel > 70 
    ? 'intense dramatic emotions' 
    : 'balanced emotional moments';
    
  const paceDesc = paceLevel < 40 
    ? 'slow contemplative pacing' 
    : paceLevel > 70 
    ? 'dynamic energetic movement' 
    : 'natural comfortable rhythm';

  // 스테이지 및 장르 정보 가져오기
  const stageInfo = stageSettings[stage] || stageSettings.teen;
  const genreInfo = genreStyles[genre] || genreStyles.drama;

  // 상세 프롬프트 구성
  let prompt = `${stageInfo.people}, ${stageInfo.clothes}, ${stageInfo.location}. They are ${stageInfo.activity}. Props include ${stageInfo.props}. `;
  prompt += `${genreInfo.lighting}, ${genreInfo.colors}, ${genreInfo.mood} atmosphere. `;
  prompt += `${realismDesc}, ${intensityDesc}, ${paceDesc}. `;
  prompt += `Wide shot showing full scene with multiple people visible. High quality cinematic video, smooth natural motion, 16:9 aspect ratio.`;

  // Rewrite Moment 추가
  if (rewriteText) {
    const endingTypes = {
      recovery: 'The scene transitions to show healing, inner peace, and emotional recovery',
      growth: 'The scene shows personal growth, learning from experience, becoming stronger',
      reconcile: 'The scene depicts forgiveness, reconciliation, rebuilding relationships',
      self_protect: 'The scene shows setting healthy boundaries, self-care, protecting oneself',
      new_start: 'The scene transitions to a fresh beginning, new chapter, hopeful future',
      comedy: 'The mood shifts to finding humor in the situation, laughing it off, lightness',
    };
    const endingDesc = endingTypes[ending] || endingTypes.growth;
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

