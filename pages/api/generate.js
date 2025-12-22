import { GoogleAuth } from 'google-auth-library';
import jwt from 'jsonwebtoken';

// Google Cloud 설정
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'rewritemoment';
const LOCATION = 'us-central1';

const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON 
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : null;

// Kling AI 설정
const KLING_ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const KLING_ACCESS_SECRET = process.env.KLING_ACCESS_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { myPhoto, actorPhoto, aspectRatio = '16:9' } = req.body;

    if (!myPhoto || !actorPhoto) {
      return res.status(400).json({ error: '사진 2장이 필요합니다' });
    }

    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    console.log('=== Gemini 합성 → Kling 영상화 파이프라인 ===');

    // 이미지 Base64 처리
    function extractBase64(imageUrl) {
      if (imageUrl.startsWith('data:')) {
        const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          return { mimeType: matches[1], base64: matches[2] };
        }
        return { mimeType: 'image/jpeg', base64: imageUrl.split(',')[1] };
      }
      return { mimeType: 'image/jpeg', base64: imageUrl };
    }

    const myPhotoData = extractBase64(myPhoto);
    const actorPhotoData = extractBase64(actorPhoto);

    console.log('내 사진 length:', myPhotoData.base64?.length);
    console.log('함께할 사람 사진 length:', actorPhotoData.base64?.length);

    // Google Auth
    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // ========================================
    // STEP 1: Gemini로 두 사람이 함께 있는 이미지 합성
    // ========================================
    console.log('\n=== STEP 1: Gemini(나노바나나) 합성 ===');

    const geminiPrompt = `You are performing a PHOTOREALISTIC FACE COMPOSITING task.

YOUR MISSION: Create a single photograph where TWO SPECIFIC PEOPLE appear together.

═══════════════════════════════════════════════════════════════
🎯 FACE IDENTITY PRESERVATION - THIS IS THE #1 PRIORITY
═══════════════════════════════════════════════════════════════

PERSON A (Image 1 → Place on LEFT side):
Analyze Image 1 carefully. The person has UNIQUE facial characteristics:
- Specific EYE SHAPE (round/almond/hooded), EYE SIZE, EYE COLOR, DISTANCE between eyes
- Specific NOSE BRIDGE WIDTH, NOSE TIP SHAPE, NOSTRIL SIZE
- Specific LIP THICKNESS (upper/lower), LIP SHAPE, MOUTH WIDTH  
- Specific JAWLINE (square/round/V-shaped), CHIN SHAPE
- Specific CHEEKBONE HEIGHT and prominence
- Specific FOREHEAD SIZE and shape
- Specific EYEBROW THICKNESS, ARCH, COLOR
- Specific SKIN TONE (warm/cool/neutral undertone), TEXTURE, any marks/moles
- Specific HAIR COLOR, TEXTURE, STYLE, HAIRLINE SHAPE

→ YOU MUST REPRODUCE EVERY SINGLE ONE OF THESE FEATURES EXACTLY AS THEY APPEAR IN IMAGE 1.

PERSON B (Image 2 → Place on RIGHT side):
Analyze Image 2 carefully. This person also has UNIQUE facial characteristics:
- Their own specific EYE SHAPE, SIZE, COLOR, SPACING
- Their own specific NOSE SHAPE and proportions
- Their own specific LIP and MOUTH features
- Their own specific JAW and CHIN structure
- Their own specific CHEEKBONES
- Their own specific FOREHEAD
- Their own specific EYEBROWS
- Their own specific SKIN TONE and TEXTURE
- Their own specific HAIR

→ YOU MUST REPRODUCE EVERY SINGLE ONE OF THESE FEATURES EXACTLY AS THEY APPEAR IN IMAGE 2.

═══════════════════════════════════════════════════════════════
❌ ABSOLUTE PROHIBITIONS - VIOLATION = TASK FAILURE
═══════════════════════════════════════════════════════════════
• DO NOT generate "similar looking" faces - use the EXACT faces
• DO NOT create an "averaged" face between the two people
• DO NOT change eye shapes to be more "standard"
• DO NOT adjust nose sizes to be more "proportional"  
• DO NOT modify lip shapes
• DO NOT alter face shapes to be more "balanced"
• DO NOT change skin tones
• DO NOT "improve" or "beautify" any features
• DO NOT make the two people look more similar to each other
• DO NOT add or remove facial features (moles, marks, etc.)

═══════════════════════════════════════════════════════════════
📸 COMPOSITION REQUIREMENTS
═══════════════════════════════════════════════════════════════
• Person A on LEFT, Person B on RIGHT
• Medium-wide shot: show from WAIST to HEAD (upper body visible)
• Distance: as if photographer is standing 2-3 meters away
• Pose: friendly, natural, like two friends taking a photo together
• Expression: natural smile or neutral
• Background: clean studio backdrop or simple indoor setting
• Lighting: soft, flattering, even on both faces

═══════════════════════════════════════════════════════════════

REMEMBER: If someone who knows Person A looks at the result, they should INSTANTLY recognize them. Same for Person B. The faces must be IDENTICAL to the input photos - this is a face PLACEMENT task, not face GENERATION.`;

    const geminiEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-exp:generateContent`;

    let compositeImageBase64 = null;
    let compositeImageMimeType = 'image/png';
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`Gemini 시도 ${attempt}/3...`);

      try {
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
                { text: "Image 1 (Person A - LEFT):" },
                {
                  inlineData: {
                    mimeType: myPhotoData.mimeType,
                    data: myPhotoData.base64,
                  }
                },
                { text: "Image 2 (Person B - RIGHT):" },
                {
                  inlineData: {
                    mimeType: actorPhotoData.mimeType,
                    data: actorPhotoData.base64,
                  }
                },
                { text: geminiPrompt }
              ]
            }],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT'],
              temperature: 0,  // 0 = 최대 일관성, 랜덤성 제거
            },
          }),
        });

        const geminiData = await geminiResponse.json();

        if (!geminiResponse.ok) {
          console.error(`Gemini Error (attempt ${attempt}):`, geminiData.error?.message);
          lastError = geminiData.error?.message || 'Gemini API 오류';
          continue;
        }

        if (geminiData.candidates?.[0]?.content?.parts) {
          for (const part of geminiData.candidates[0].content.parts) {
            if (part.inlineData) {
              compositeImageBase64 = part.inlineData.data;
              compositeImageMimeType = part.inlineData.mimeType || 'image/png';
              console.log(`합성 이미지 생성됨 (attempt ${attempt}), length:`, compositeImageBase64?.length);
              break;
            }
          }
        }

        if (compositeImageBase64) {
          break;
        } else {
          console.log(`Gemini가 이미지를 생성하지 않음 (attempt ${attempt})`);
          lastError = 'Gemini가 이미지를 생성하지 못했습니다';
        }

      } catch (fetchError) {
        console.error(`Gemini fetch error (attempt ${attempt}):`, fetchError.message);
        lastError = fetchError.message;
      }

      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!compositeImageBase64) {
      return res.status(500).json({ 
        error: '이미지 합성 실패', 
        details: lastError || 'Gemini가 합성 이미지를 생성하지 못했습니다.' 
      });
    }

    // ========================================
    // STEP 2: 영상 생성 (Kling AI 또는 Veo)
    // ========================================
    
    // Kling API 키가 있으면 Kling 사용, 없으면 Veo 사용
    const useKling = KLING_ACCESS_KEY && KLING_ACCESS_SECRET;
    
    if (useKling) {
      console.log('\n=== STEP 2: Kling AI 영상화 ===');
      
      // JWT 토큰 생성 (Kling AI 인증)
      const now = Math.floor(Date.now() / 1000);
      const klingToken = jwt.sign(
        {
          iss: KLING_ACCESS_KEY,
          exp: now + 1800, // 30분
          nbf: now - 5,
        },
        KLING_ACCESS_SECRET,
        { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
      );

      const klingResponse = await fetch('https://api.klingai.com/v1/videos/image2video', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${klingToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_name: 'kling-v1',
          image: `data:${compositeImageMimeType};base64,${compositeImageBase64}`,
          prompt: 'Animate this photo with MINIMAL movement. CRITICAL FACE RULE: Both faces must remain EXACTLY as shown in the image - preserve exact eye shape, nose shape, lip shape, jaw line, skin tone for BOTH people. DO NOT morph, change, or modify any facial features. Animation allowed: very subtle breathing motion in chest/shoulders, gentle natural eye blinks (2-3 times), micro head tilts (less than 5 degrees). Keep faces almost FROZEN - they should look identical frame by frame. Warm soft lighting. Cinematic quality.',
          duration: '5',
          aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9',
          mode: 'std',
        }),
      });

      const klingData = await klingResponse.json();

      if (!klingResponse.ok || klingData.code !== 0) {
        console.error('Kling Error:', klingData);
        return res.status(500).json({ 
          error: 'Kling 영상 생성 실패',
          details: klingData.message || klingData.error?.message
        });
      }

      console.log('Kling 작업 시작:', klingData.data?.task_id);

      return res.status(200).json({
        id: klingData.data?.task_id,
        status: 'processing',
        message: 'Gemini 합성 완료 → Kling 영상 생성 중',
        provider: 'kling',
      });
    } else {
      // Veo로 fallback
      console.log('\n=== STEP 2: Veo 영상화 (Kling 키 없음) ===');
      
      const veoEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/veo-2.0-generate-001:predictLongRunning`;

      const videoPrompt = `Create a subtle animation from this photo.

═══ FACE PRESERVATION (HIGHEST PRIORITY) ═══
Both people's faces MUST remain EXACTLY as shown:
- Same eye shape, eye color, eye size, eye spacing
- Same nose bridge, nose tip, nostril shape
- Same lip shape, lip thickness, mouth width
- Same jawline, chin shape, cheekbone position
- Same skin tone, skin texture
- Same eyebrow shape and thickness
- Same hair color and style

DO NOT change, morph, or modify ANY facial features.
Faces should be nearly STATIC - identical frame by frame.

═══ ALLOWED ANIMATION (very subtle) ═══
- Gentle breathing (chest/shoulder movement only)
- Natural eye blinks (2-3 times in 8 seconds)
- Micro head movements (less than 3 degrees)
- Soft ambient motion in background

═══ FORBIDDEN ═══
- Face morphing or warping
- Expression changes that alter face shape
- Skin tone shifts
- Eye shape changes
- Any modification to facial features

Warm cinematic lighting. 8 seconds. High quality.`;

      const auth = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();

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
            aspectRatio: aspectRatio || '16:9',
            sampleCount: 1,
            durationSeconds: 8,
            personGeneration: 'allow_adult',
          },
        }),
      });

      const veoData = await veoResponse.json();

      if (!veoResponse.ok) {
        console.error('Veo Error:', veoData);
        return res.status(500).json({ 
          error: 'Veo 영상 생성 실패',
          details: veoData.error?.message || JSON.stringify(veoData)
        });
      }

      console.log('Veo 작업 시작:', veoData.name);

      return res.status(200).json({
        id: veoData.name,
        status: 'processing',
        message: 'Gemini 합성 완료 → Veo 영상 생성 중',
        provider: 'veo',
      });
    }

  } catch (error) {
    console.error('전체 에러:', error);
    return res.status(500).json({ 
      error: '영상 생성 실패',
      details: error.message
    });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '20mb' },
    responseLimit: false,
  },
};
