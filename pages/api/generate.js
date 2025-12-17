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
      return res.status(400).json({ error: 'Image URL is required' });
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

    console.log('=== Video Generation Request ===');
    console.log('Stage:', stage);
    console.log('Genre:', genre);
    console.log('Mode:', mode);
    console.log('Rewrite:', rewriteText ? 'Yes' : 'No');
    console.log('Full Prompt:', fullPrompt);
    console.log('================================');

    // Use Minimax Video-01 for high quality video generation
    const prediction = await replicate.predictions.create({
      model: "minimax/video-01",
      input: {
        prompt: fullPrompt,
        first_frame_image: imageUrl,
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
  
  // ========================================
  // 1. LIFE STAGE - 라이프 스테이지별 장면 설정
  // ========================================
  const stageSettings = {
    teen: {
      scene: 'A teenage student in a high school classroom or campus',
      context: 'surrounded by friends, backpacks, lockers, school uniform',
      emotion: 'youthful energy, curiosity, growing pains, friendship bonds',
      props: 'textbooks, smartphone, school bag, sports equipment',
    },
    twenties: {
      scene: 'A young adult in their 20s at a coffee shop or modern office',
      context: 'laptop, career ambitions, first apartment, dating life',
      emotion: 'hopeful uncertainty, self-discovery, ambition, romantic tension',
      props: 'coffee cup, resume, apartment keys, dating app notifications',
    },
    newlywed: {
      scene: 'A newlywed couple in their cozy new home',
      context: 'wedding rings, shared space, building life together',
      emotion: 'tender love, excitement, partnership, domestic bliss',
      props: 'wedding photo, cooking together, unpacking boxes, couple activities',
    },
    early_parenting: {
      scene: 'A parent with their toddler in a warm family home',
      context: 'toys scattered, baby items, exhausted but happy',
      emotion: 'unconditional love, tired joy, protective instincts, precious moments',
      props: 'baby toys, stroller, family photos, children books',
    },
  };

  // ========================================
  // 2. GENRE - 장르별 시각적 스타일
  // ========================================
  const genreStyles = {
    docu: {
      visual: 'Documentary style cinematography, handheld camera feel, natural available lighting',
      color: 'Muted earth tones, desaturated colors, authentic raw look',
      mood: 'Intimate, observational, truthful, slice-of-life',
      camera: 'Close-up interviews, candid moments, fly-on-the-wall perspective',
    },
    comedy: {
      visual: 'Bright saturated colors, well-lit scenes, sitcom-style framing',
      color: 'Vibrant warm colors, high contrast, cheerful palette',
      mood: 'Lighthearted, playful, amusing, feel-good',
      camera: 'Wide shots for physical comedy, quick cuts, reaction shots',
    },
    drama: {
      visual: 'Cinematic dramatic lighting, deep shadows, high contrast',
      color: 'Rich deep colors, moody tones, dramatic color grading',
      mood: 'Intense, emotional, powerful, thought-provoking',
      camera: 'Slow dolly movements, meaningful close-ups, dramatic angles',
    },
    melo: {
      visual: 'Soft diffused lighting, romantic glow, dreamy atmosphere',
      color: 'Warm golden hour tones, soft pastels, romantic pink hues',
      mood: 'Tender, emotional, bittersweet, heart-touching',
      camera: 'Slow motion moments, lingering gazes, intimate framing',
    },
    fantasy: {
      visual: 'Magical ethereal lighting, lens flares, surreal elements',
      color: 'Vibrant otherworldly colors, magical glows, iridescent highlights',
      mood: 'Whimsical, dreamlike, enchanting, wonder-filled',
      camera: 'Sweeping movements, magical reveals, fantastical angles',
    },
  };

  // ========================================
  // 3. SLIDERS - 분위기 조절
  // ========================================
  const realismLevel = sliders.realism || 60;
  const intensityLevel = sliders.intensity || 40;
  const paceLevel = sliders.pace || 70;

  // 현실감 (0=영화적, 100=현실적)
  const realismDesc = realismLevel < 30 
    ? 'highly stylized cinematic look, movie-like aesthetics' 
    : realismLevel < 70 
    ? 'balanced cinematic realism, natural yet polished' 
    : 'ultra-realistic, documentary authenticity, raw and genuine';

  // 강도 (0=순한맛, 100=진한맛)
  const intensityDesc = intensityLevel < 30 
    ? 'subtle gentle emotions, understated expressions' 
    : intensityLevel < 70 
    ? 'moderate emotional intensity, balanced drama' 
    : 'powerful intense emotions, dramatic peaks, heightened feelings';

  // 속도 (0=느리게, 100=빠르게)
  const paceDesc = paceLevel < 30 
    ? 'slow contemplative pacing, lingering moments, meditative rhythm' 
    : paceLevel < 70 
    ? 'natural moderate pacing, comfortable rhythm' 
    : 'dynamic fast pacing, energetic movements, quick transitions';

  // ========================================
  // 4. REWRITE MOMENT - 결말 재구성
  // ========================================
  let rewriteSection = '';
  
  if (rewriteText) {
    // 거리두기 설정
    const distanceStyles = {
      symbolic: 'expressed through abstract metaphors and symbols, not literal',
      similar: 'reimagined in a parallel situation, similar but different context',
      quite_similar: 'closely mirrored scenario with key differences',
    };

    // 결말 방향
    const endingStyles = {
      recovery: 'finding healing and inner peace, wounds slowly mending',
      growth: 'learning and becoming stronger, wisdom gained from experience',
      reconcile: 'making amends, rebuilding bridges, forgiveness and understanding',
      self_protect: 'setting healthy boundaries, self-care, protecting inner peace',
      new_start: 'fresh beginnings, leaving the past behind, hopeful new chapter',
      comedy: 'finding humor in adversity, laughing through tears, lighthearted resolution',
    };

    const distanceDesc = distanceStyles[distance] || distanceStyles.similar;
    const endingDesc = endingStyles[ending] || endingStyles.growth;

    rewriteSection = `
    
REWRITE MOMENT TRANSFORMATION:
The video shows a pivotal moment being rewritten. The original difficult experience "${rewriteText}" is ${distanceDesc}.
The scene transforms to show: ${endingDesc}.
The ending conveys hope, resolution, and emotional catharsis.`;
  }

  // ========================================
  // 5. BUILD FINAL PROMPT
  // ========================================
  const stageInfo = stageSettings[stage] || stageSettings.teen;
  const genreInfo = genreStyles[genre] || genreStyles.drama;

  const finalPrompt = `
SCENE: ${stageInfo.scene}
CONTEXT: ${stageInfo.context}
EMOTIONAL TONE: ${stageInfo.emotion}

VISUAL STYLE: ${genreInfo.visual}
COLOR PALETTE: ${genreInfo.color}
MOOD: ${genreInfo.mood}
CAMERA WORK: ${genreInfo.camera}

ATMOSPHERE SETTINGS:
- Realism: ${realismDesc}
- Intensity: ${intensityDesc}
- Pacing: ${paceDesc}
${rewriteSection}

TECHNICAL REQUIREMENTS:
- The person's face must remain clear and consistent throughout
- Smooth natural motion, no jarring movements
- High quality cinematic production value
- Portrait orientation (9:16) for social media
- 5 seconds of engaging content
`.trim();

  return finalPrompt;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false,
  },
};

