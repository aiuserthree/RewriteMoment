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
      imageUrl,       // 사용자 셀카 이미지
      aspectRatio = '16:9',
      movie,
    } = req.body;

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

    console.log('=== 나노바나나 합성 파이프라인 ===');
    console.log('Movie:', movie, '-', movieInfo.koreanTitle);
    console.log('User Image length:', userImageBase64?.length);

    // Google Auth
    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // ========================================
    // STEP 1: 나노바나나(Gemini)로 합성 이미지 생성
    // 사용자 얼굴 + 배우들 함께 있는 이미지
    // ========================================
    console.log('\n=== STEP 1: 나노바나나 합성 ===');

    const compositePrompt = buildCompositePrompt(movieInfo, aspectRatio);
    console.log('Prompt:', compositePrompt.substring(0, 300) + '...');

    // Gemini 2.0 Flash (나노바나나)
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
            {
              text: compositePrompt
            }
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
        details: geminiData.error?.message || JSON.stringify(geminiData)
      });
    }

    // 생성된 이미지 추출
    let compositeImageBase64 = null;
    let compositeImageMimeType = 'image/png';

    console.log('Gemini response candidates:', geminiData.candidates?.length);

    if (geminiData.candidates?.[0]?.content?.parts) {
      for (const part of geminiData.candidates[0].content.parts) {
        if (part.inlineData) {
          compositeImageBase64 = part.inlineData.data;
          compositeImageMimeType = part.inlineData.mimeType || 'image/png';
          console.log('합성 이미지 생성 완료! length:', compositeImageBase64?.length);
          break;
        }
        if (part.text) {
          console.log('Gemini text response:', part.text.substring(0, 200));
        }
      }
    }

    if (!compositeImageBase64) {
      console.error('Gemini가 이미지를 생성하지 않음');
      console.error('Full response:', JSON.stringify(geminiData, null, 2));
      return res.status(500).json({ 
        error: '합성 이미지 생성 실패 - Gemini가 이미지를 반환하지 않았습니다',
        details: 'responseModalities에 IMAGE가 포함되어 있는지 확인하세요'
      });
    }

    // ========================================
    // STEP 2: Veo로 영상 생성
    // ========================================
    console.log('\n=== STEP 2: Veo 영상 생성 ===');

    const videoPrompt = buildVideoPrompt(movieInfo);
    console.log('Video Prompt:', videoPrompt.substring(0, 200) + '...');

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
        error: 'Veo 영상 생성 실패', 
        details: veoData.error?.message 
      });
    }

    console.log('Veo 시작:', veoData.name);

    return res.status(200).json({
      id: veoData.name,
      status: 'processing',
      message: '나노바나나 합성 → Veo 영상 생성 시작',
      provider: 'google-veo',
      pipeline: 'nanobanana-veo'
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: '영상 생성 실패',
      details: error.message 
    });
  }
}

// 영화 정보
function getMovieInfo(movie) {
  const movieSettings = {
    avengers: {
      title: 'Avengers',
      koreanTitle: '어벤저스',
      actors: [
        { name: 'Iron Man', realName: 'Robert Downey Jr.', description: 'Iron Man suit with glowing arc reactor, goatee beard, confident smirk' },
        { name: 'Captain America', realName: 'Chris Evans', description: 'blonde muscular man in blue Captain America suit with white star, holding round shield' },
      ],
      background: 'Avengers movie set with high-tech lab, superhero props, studio lights',
    },
    spiderman: {
      title: 'Spider-Man',
      koreanTitle: '스파이더맨',
      actors: [
        { name: 'Spider-Man', realName: 'Tom Holland', description: 'young man in red and blue Spider-Man suit, mask pulled off showing friendly face' },
        { name: 'MJ', realName: 'Zendaya', description: 'beautiful young woman with curly dark hair, casual style' },
      ],
      background: 'Spider-Man movie set with New York City rooftop backdrop',
    },
    harrypotter: {
      title: 'Harry Potter',
      koreanTitle: '해리포터',
      actors: [
        { name: 'Harry Potter', realName: 'Daniel Radcliffe', description: 'young man with messy black hair, round glasses, lightning bolt scar, Gryffindor robes' },
        { name: 'Hermione', realName: 'Emma Watson', description: 'young woman with wavy brown hair, intelligent expression, Gryffindor robes' },
      ],
      background: 'Hogwarts Great Hall with floating candles, long wooden tables, magical atmosphere',
    },
    lotr: {
      title: 'Lord of the Rings',
      koreanTitle: '반지의 제왕',
      actors: [
        { name: 'Gandalf', realName: 'Ian McKellen', description: 'elderly wizard with long grey beard, grey robes and hat, wooden staff' },
        { name: 'Aragorn', realName: 'Viggo Mortensen', description: 'rugged man with stubble, long dark hair, ranger clothes' },
      ],
      background: 'Middle-earth movie set with elvish architecture, fantasy landscape',
    },
    starwars: {
      title: 'Star Wars',
      koreanTitle: '스타워즈',
      actors: [
        { name: 'Luke Skywalker', realName: 'Mark Hamill', description: 'young man in Jedi robes holding blue lightsaber' },
        { name: 'Princess Leia', realName: 'Carrie Fisher', description: 'elegant woman with iconic side hair buns, white robes' },
      ],
      background: 'Star Wars movie set with Millennium Falcon, droids R2-D2 and C-3PO',
    },
    jurassic: {
      title: 'Jurassic Park',
      koreanTitle: '쥬라기 공원',
      actors: [
        { name: 'Dr. Alan Grant', realName: 'Sam Neill', description: 'paleontologist in khaki clothes and hat' },
        { name: 'Dr. Ian Malcolm', realName: 'Jeff Goldblum', description: 'charismatic man in black leather jacket' },
      ],
      background: 'Jurassic Park set with animatronic T-Rex dinosaur, jungle foliage',
    },
  };

  return movieSettings[movie] || movieSettings.avengers;
}

// 나노바나나 합성 프롬프트
function buildCompositePrompt(movieInfo, aspectRatio) {
  const actor1 = movieInfo.actors[0];
  const actor2 = movieInfo.actors[1];

  return `이 사진에 있는 사람의 얼굴을 그대로 사용해서 새로운 이미지를 만들어줘.

[중요] 이 사진 속 인물의 얼굴을 절대 바꾸지 마. 똑같은 얼굴이어야 해.

만들어야 할 이미지:
- 이 사진 속 인물이 영화배우들과 함께 셀카를 찍는 장면
- 가운데: 이 사진 속 인물 (얼굴 그대로!)
- 왼쪽: ${actor1.name} (${actor1.realName}) - ${actor1.description}
- 오른쪽: ${actor2.name} (${actor2.realName}) - ${actor2.description}

장면 설정:
- 배경: ${movieInfo.background}
- 세 사람이 어깨동무하고 셀카 찍는 포즈
- 모두 카메라를 보며 환하게 웃는 표정
- 친근하고 즐거운 분위기

스타일:
- 진짜 아이폰으로 찍은 셀카처럼 사실적으로
- ${aspectRatio === '9:16' ? '세로 방향' : '가로 방향'}
- 고화질, 선명한 얼굴

다시 한번 강조: 업로드한 이 사진 속 인물의 얼굴을 절대 바꾸지 말고 그대로 사용해!`;
}

// Veo 영상 프롬프트
function buildVideoPrompt(movieInfo) {
  return `이 셀카 사진을 자연스러운 8초 영상으로 만들어줘.

[중요] 사진 속 모든 사람의 얼굴을 절대 바꾸지 마. 영상 내내 똑같은 얼굴이어야 해.

영상 흐름 (8초):
0-2초: 세 사람이 셀카 포즈, 카메라 보며 웃음
2-4초: 누군가 재밌는 말을 해서 다 같이 웃음
4-6초: 하이파이브하거나 어깨 툭툭
6-8초: 배우들이 "바이바이~" 하며 촬영장으로 돌아감

스타일:
- 비하인드 씬 브이로그 느낌
- 자연스러운 움직임
- 따뜻하고 친근한 분위기
- 카메라 살짝 흔들리는 핸드헬드 느낌

절대 얼굴이 변형되거나 바뀌면 안 됨!`;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false,
  },
};
