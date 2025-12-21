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

    const movieInfo = getMovieInfo(movie);

    console.log('=== Gemini 합성 → Veo 영상 ===');
    console.log('Movie:', movieInfo.koreanTitle);
    console.log('User image length:', userImageBase64?.length);

    // Google Auth
    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // ========================================
    // STEP 1: Gemini (Imagen)로 합성 이미지 생성
    // ========================================
    console.log('\n=== STEP 1: Gemini 이미지 합성 ===');

    const imagePrompt = `Look at the person in this photo carefully. 
    
Create a NEW image where:
- This EXACT same person (same face, same features) is in the CENTER
- ${movieInfo.actors} are standing next to them
- They are all taking a group selfie together on ${movieInfo.background}
- Everyone is smiling warmly at the camera
- The person from the original photo must look IDENTICAL - same face shape, eyes, nose, mouth, skin tone, hair

Style: Photorealistic, like a real iPhone selfie photo, high quality, 4K`;

    console.log('Image prompt:', imagePrompt.substring(0, 200) + '...');

    // Gemini 2.0 Flash로 이미지 생성
    const geminiEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-exp:generateContent`;

    const geminiResponse = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: userImageBase64,
              }
            },
            { text: imagePrompt }
          ]
        }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          temperature: 1.0,
        },
      }),
    });

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Gemini Error:', JSON.stringify(geminiData, null, 2));
      return res.status(500).json({ 
        error: 'Gemini 합성 실패', 
        details: geminiData.error?.message || 'Unknown error'
      });
    }

    // 생성된 이미지 추출
    let compositeImageBase64 = null;
    let compositeImageMimeType = 'image/png';

    if (geminiData.candidates?.[0]?.content?.parts) {
      for (const part of geminiData.candidates[0].content.parts) {
        if (part.inlineData) {
          compositeImageBase64 = part.inlineData.data;
          compositeImageMimeType = part.inlineData.mimeType || 'image/png';
          console.log('합성 이미지 생성됨, length:', compositeImageBase64?.length);
          break;
        }
      }
    }

    // Gemini가 이미지를 생성하지 않은 경우 - 원본 이미지로 진행
    if (!compositeImageBase64) {
      console.log('Gemini가 이미지를 생성하지 않음, 원본 이미지로 진행');
      compositeImageBase64 = userImageBase64;
      compositeImageMimeType = mimeType;
    }

    // ========================================
    // STEP 2: Veo로 영상 생성
    // ========================================
    console.log('\n=== STEP 2: Veo 영상화 ===');

    const videoPrompt = `Create an 8-second video from this image.

The video shows:
- The people in this image taking a group selfie
- Natural small movements - smiling, slight head turns, blinking
- Someone makes a joke, everyone laughs
- At the end, the movie actors wave goodbye

CRITICAL: Keep ALL faces EXACTLY the same throughout. No morphing or changing faces.

Style: Behind-the-scenes vlog feel, candid and warm, slight camera movement.`;

    console.log('Calling Veo...');

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
            bytesBase64Encoded: compositeImageBase64,
            mimeType: compositeImageMimeType,
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
        error: 'Veo 실패', 
        details: veoData.error?.message || 'Unknown error'
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
    console.error('Error:', error);
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
      actors: 'Iron Man (a man in red and gold high-tech armor suit) and Captain America (a muscular blonde man in blue uniform with star)',
      background: 'a movie set with superhero props and bright studio lights',
    },
    spiderman: {
      koreanTitle: '스파이더맨',
      actors: 'Spider-Man (a young man in red and blue spider suit) and MJ (a young woman with curly dark hair)',
      background: 'a movie set with New York City backdrop',
    },
    harrypotter: {
      koreanTitle: '해리포터',
      actors: 'Harry Potter (a young man with round glasses and lightning scar) and Hermione (a young woman with wavy brown hair in school robes)',
      background: 'a magical Great Hall movie set with floating candles',
    },
    lotr: {
      koreanTitle: '반지의 제왕',
      actors: 'Gandalf (an elderly wizard with long grey beard and staff) and Aragorn (a rugged man with sword)',
      background: 'a fantasy Middle-earth movie set',
    },
    starwars: {
      koreanTitle: '스타워즈',
      actors: 'Luke Skywalker (a young man in Jedi robes with lightsaber) and Princess Leia (a woman with side hair buns in white robes)',
      background: 'a Star Wars movie set with spaceship props',
    },
    jurassic: {
      koreanTitle: '쥬라기 공원',
      actors: 'Dr. Alan Grant (a man in khaki clothes) and Dr. Ian Malcolm (a man in black leather jacket)',
      background: 'a Jurassic Park movie set with dinosaur props',
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
