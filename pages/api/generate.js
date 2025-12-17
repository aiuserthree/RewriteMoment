import Replicate from 'replicate';

// Remove BOM and whitespace from token
const apiToken = (process.env.REPLICATE_API_TOKEN || '').replace(/^\uFEFF/, '').trim();

const replicate = new Replicate({
  auth: apiToken,
});

// Video generation models on Replicate
const MODELS = {
  // Stable Video Diffusion - Image to Video
  svd: "stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438",
  // Minimax Video (Hailuo) - High quality
  minimax: "minimax/video-01",
  // Kling - Good for character consistency  
  kling: "fofr/kling-video:abb95f9b7093e7c0e0c05297df0e9e7a1cdd9c9e1a0f2f4e1a0f2f4e1a0f2f4e",
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      imageUrl,      // Base64 or URL of uploaded image
      prompt,        // Text prompt for video generation
      mode = 'quick', // quick, story, trailer
      rewriteText,   // Optional rewrite moment text
      stage,         // teen, 20s, newlywed, parenting
      genre,         // docu, comedy, drama, melo, fantasy
    } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    // Build prompt based on selections
    const fullPrompt = buildPrompt({ prompt, rewriteText, stage, genre, mode });

    console.log('Starting video generation with prompt:', fullPrompt);

    // Use Stable Video Diffusion for image-to-video
    const prediction = await replicate.predictions.create({
      version: "3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438",
      input: {
        input_image: imageUrl,
        // SVD parameters
        motion_bucket_id: 127, // Higher = more motion
        fps: 7,
        cond_aug: 0.02,
        decoding_t: 14,
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

// Build prompt based on user selections
function buildPrompt({ prompt, rewriteText, stage, genre, mode }) {
  const stagePrompts = {
    teen: '청소년기, 학교, 친구들, 성장',
    '20s': '20대, 대학생활, 취업, 연애, 자아찾기',
    newlywed: '신혼, 결혼, 새로운 시작, 함께하는 삶',
    parenting: '육아, 부모됨, 가족, 아이와 함께',
  };

  const genreStyles = {
    docu: 'cinematic documentary style, natural lighting, authentic moments',
    comedy: 'bright colors, comedic timing, lighthearted mood, funny situations',
    drama: 'dramatic lighting, emotional depth, intense atmosphere',
    melo: 'romantic atmosphere, soft lighting, emotional, touching moments',
    fantasy: 'magical elements, surreal visuals, dreamlike atmosphere, fantasy world',
  };

  let finalPrompt = prompt || 'A person in a meaningful moment of their life';
  
  if (stage && stagePrompts[stage]) {
    finalPrompt += `, ${stagePrompts[stage]}`;
  }
  
  if (genre && genreStyles[genre]) {
    finalPrompt += `. Style: ${genreStyles[genre]}`;
  }
  
  if (rewriteText) {
    finalPrompt += `. The scene transforms to show: ${rewriteText}`;
  }

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

