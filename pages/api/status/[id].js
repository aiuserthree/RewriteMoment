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
    
    // fetchPredictOperation API 사용
    const statusResponse = await fetch(
      `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/veo-3.0-generate-preview:fetchPredictOperation`,
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

    const statusData = await statusResponse.json();

    if (!statusResponse.ok) {
      console.error('Veo Status API Error:', statusData);
      return res.status(statusResponse.status).json({ 
        error: 'Veo API error',
        details: statusData.error?.message || JSON.stringify(statusData)
      });
    }

    console.log('Veo Status:', JSON.stringify(statusData, null, 2));

    // 상태 변환
    let status = 'processing';
    let videoUrl = null;
    let videoBase64 = null;
    let mimeType = null;

    if (statusData.done === true) {
      if (statusData.error) {
        status = 'failed';
      } else {
        status = 'succeeded';
        // 비디오 데이터 추출 - Veo는 Base64로 반환
        const videos = statusData.response?.videos;
        if (videos && videos.length > 0) {
          videoBase64 = videos[0].bytesBase64Encoded;
          mimeType = videos[0].mimeType || 'video/mp4';
          
          // Base64를 Data URL로 변환
          if (videoBase64) {
            videoUrl = `data:${mimeType};base64,${videoBase64}`;
          }
          
          // GCS URI 방식도 지원
          if (videos[0].gcsUri) {
            const gcsUri = videos[0].gcsUri;
            const bucket = gcsUri.replace('gs://', '').split('/')[0];
            const path = gcsUri.replace(`gs://${bucket}/`, '');
            videoUrl = `https://storage.googleapis.com/${bucket}/${path}`;
          }
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

