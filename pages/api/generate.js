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
        prompt_optimizer: true,  // 프롬프트 최적화
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
  
  // 라이프 스테이지별 장면
  const stageScenes = {
    teen: 'teenage student at school with friends, youthful energy',
    twenties: 'young adult in their 20s at cafe or office, hopeful and ambitious',
    newlywed: 'newlywed couple at home, tender love and partnership',
    early_parenting: 'parent with young child, warm family moments',
  };

  // 장르별 스타일
  const genreStyles = {
    docu: 'documentary style, natural lighting, authentic candid moments',
    comedy: 'bright cheerful colors, playful mood, lighthearted funny atmosphere',
    drama: 'cinematic dramatic lighting, emotional intensity, powerful atmosphere',
    melo: 'soft romantic lighting, warm golden tones, tender emotional moments',
    fantasy: 'magical ethereal lighting, dreamy surreal atmosphere, enchanting',
  };

  // 슬라이더 값
  const realismLevel = parseInt(sliders?.realism) || 60;
  const intensityLevel = parseInt(sliders?.intensity) || 40;
  const paceLevel = parseInt(sliders?.pace) || 70;

  // 분위기 설명
  const realismDesc = realismLevel < 40 ? 'stylized cinematic' : realismLevel > 70 ? 'ultra realistic' : 'natural balanced';
  const intensityDesc = intensityLevel < 40 ? 'gentle subtle' : intensityLevel > 70 ? 'intense dramatic' : 'moderate';
  const paceDesc = paceLevel < 40 ? 'slow contemplative' : paceLevel > 70 ? 'dynamic fast' : 'natural rhythm';

  // 기본 프롬프트 구성
  const scene = stageScenes[stage] || stageScenes.teen;
  const style = genreStyles[genre] || genreStyles.drama;
  
  let prompt = `${scene}. ${style}. ${realismDesc} look, ${intensityDesc} emotion, ${paceDesc} pacing. Face clearly visible, smooth motion, high quality cinematic video.`;

  // Rewrite Moment 추가
  if (rewriteText) {
    const endingTypes = {
      recovery: 'healing and peace',
      growth: 'learning and becoming stronger',
      reconcile: 'forgiveness and understanding',
      self_protect: 'setting healthy boundaries',
      new_start: 'fresh hopeful beginning',
      comedy: 'finding humor and lightness',
    };
    const endingDesc = endingTypes[ending] || 'positive transformation';
    prompt += ` Scene transforms showing ${endingDesc}.`;
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

