import { GoogleAuth } from 'google-auth-library';

// Google Cloud 설정
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'rewritemoment';
const LOCATION = 'us-central1';

// 서비스 계정 인증 정보
const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON 
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : null;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Operation ID is required' });
  }

  try {
    if (!credentials) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    // Google Auth 설정
    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    // Operation ID를 URL-safe하게 처리
    const operationId = decodeURIComponent(id);
    
    // Operation 상태 조회 - fetchPredictOperation API 사용
    // operationId에서 모델 이름 추출
    console.log('Checking operation:', operationId);
    
    // operationId 형식: projects/xxx/locations/xxx/publishers/google/models/MODEL_NAME/operations/xxx
    const modelMatch = operationId.match(/models\/([^\/]+)\/operations/);
    const modelName = modelMatch ? modelMatch[1] : 'veo-2.0-generate-001';
    
    console.log('Model name:', modelName);
    
    const statusResponse = await fetch(
      `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelName}:fetchPredictOperation`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operationName: operationId
        }),
      }
    );
    
    // 응답이 JSON인지 확인
    const contentType = statusResponse.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await statusResponse.text();
      console.error('Non-JSON response:', text.substring(0, 200));
      return res.status(500).json({ 
        error: 'Invalid API response',
        details: 'Google API returned non-JSON response'
      });
    }

    const statusData = await statusResponse.json();

    if (!statusResponse.ok) {
      console.error('Veo Status API Error:', statusData);
      return res.status(statusResponse.status).json({ 
        error: 'Veo API error',
        details: statusData.error?.message || JSON.stringify(statusData)
      });
    }

    // 전체 응답 로그
    console.log('=== Full Veo Status Response ===');
    console.log(JSON.stringify(statusData, null, 2));
    console.log('================================');

    // 상태 변환
    let status = 'processing';
    let videoUrl = null;

    if (statusData.done === true) {
      if (statusData.error) {
        status = 'failed';
        console.error('Veo generation failed:', statusData.error);
      } else {
        status = 'succeeded';
        
        // 비디오 데이터 추출 - 모든 가능한 경로 탐색
        let videos = null;
        
        // 여러 경로 시도
        const possiblePaths = [
          statusData.response?.videos,
          statusData.response?.predictions,
          statusData.response?.generatedSamples,
          statusData.result?.videos,
          statusData.result?.predictions,
          statusData.result?.generatedSamples,
          statusData.videos,
          statusData.predictions,
          statusData.generatedSamples,
        ];

        for (const path of possiblePaths) {
          if (path && Array.isArray(path) && path.length > 0) {
            videos = path;
            console.log('Found videos at path, count:', videos.length);
            break;
          }
        }

        if (videos && videos.length > 0) {
          const video = videos[0];
          console.log('Video object keys:', Object.keys(video));
          
          // Base64 인코딩된 비디오
          if (video.bytesBase64Encoded) {
            const mimeType = video.mimeType || 'video/mp4';
            videoUrl = `data:${mimeType};base64,${video.bytesBase64Encoded}`;
            console.log('Video URL created (Base64), length:', videoUrl.length);
          }
          
          // video 속성
          if (video.video?.bytesBase64Encoded && !videoUrl) {
            const mimeType = video.video.mimeType || 'video/mp4';
            videoUrl = `data:${mimeType};base64,${video.video.bytesBase64Encoded}`;
            console.log('Video URL created (video.bytesBase64Encoded), length:', videoUrl.length);
          }
          
          // GCS URI
          if (video.gcsUri && !videoUrl) {
            const gcsUri = video.gcsUri;
            const bucket = gcsUri.replace('gs://', '').split('/')[0];
            const path = gcsUri.replace(`gs://${bucket}/`, '');
            videoUrl = `https://storage.googleapis.com/${bucket}/${path}`;
            console.log('Video URL (GCS):', videoUrl);
          }

          // 직접 URL
          if (video.uri && !videoUrl) {
            videoUrl = video.uri;
            console.log('Video URL (direct):', videoUrl);
          }
          
          // video.uri
          if (video.video?.uri && !videoUrl) {
            videoUrl = video.video.uri;
            console.log('Video URL (video.uri):', videoUrl);
          }
        }

        if (!videoUrl) {
          console.error('No video URL found. Response keys:', Object.keys(statusData));
          if (statusData.response) console.error('Response keys:', Object.keys(statusData.response));
        }
      }
    }

    return res.status(200).json({
      id: operationId,
      status: status,
      output: videoUrl,
      error: statusData.error?.message,
      metadata: statusData.metadata,
      provider: 'google-veo'
    });

  } catch (error) {
    console.error('Status check error:', error);
    return res.status(500).json({ 
      error: 'Failed to check status',
      details: error.message 
    });
  }
}

