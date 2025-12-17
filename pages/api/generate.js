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

    // Use Minimax Video-01 for high quality image-to-video with text prompt
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

// Build prompt based on user selections
function buildPrompt({ prompt, rewriteText, stage, genre, mode }) {
  // Stage-specific scene descriptions
  const stageScenes = {
    teen: 'A teenager in a school setting, with classmates and friends, experiencing youth and growth moments',
    twenties: 'A young adult in their 20s, navigating college life, career beginnings, relationships, and self-discovery',
    newlywed: 'A newlywed couple starting their new life together, moments of love and partnership',
    early_parenting: 'A parent with their young child, tender family moments, the journey of parenthood',
  };

  // Genre-specific visual styles and moods
  const genreStyles = {
    docu: 'Documentary style, natural lighting, authentic candid moments, warm color grading, intimate camera angles',
    comedy: 'Bright cheerful lighting, vibrant colors, playful expressions, comedic timing, light-hearted atmosphere, subtle humor',
    drama: 'Cinematic dramatic lighting, deep shadows, emotional intensity, meaningful glances, powerful atmosphere',
    melo: 'Soft romantic lighting, warm golden tones, tender emotional moments, gentle movements, touching atmosphere',
    fantasy: 'Magical ethereal lighting, dreamy soft focus, surreal elements, sparkles and gentle glow, whimsical atmosphere',
  };

  // Base scene description
  let sceneDesc = stageScenes[stage] || 'A person in a meaningful moment of their life';
  
  // Add genre style
  let styleDesc = genreStyles[genre] || 'Cinematic quality, professional lighting';
  
  // Combine into final prompt
  let finalPrompt = `${sceneDesc}. ${styleDesc}. The person's face is clearly visible and well-preserved throughout the video. Smooth natural motion, high quality, 4K cinematic`;
  
  // Add rewrite transformation if provided
  if (rewriteText) {
    finalPrompt += `. The scene shows a moment of transformation: ${rewriteText}, leading to a positive resolution`;
  }

  // Add mode-specific instructions
  if (mode === 'trailer') {
    finalPrompt += '. Epic cinematic trailer style with dramatic pacing';
  } else if (mode === 'story') {
    finalPrompt += '. Narrative storytelling with emotional arc';
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

