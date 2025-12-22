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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  const provider = req.query.provider || 'auto';

  if (!id) {
    return res.status(400).json({ error: 'Task ID is required' });
  }

  try {
    const taskId = decodeURIComponent(id);
    console.log('Checking task:', taskId, 'provider:', provider);

    // Kling AI 작업인지 확인 (ID가 Veo 형식이 아니면 Kling)
    const isKling = !taskId.includes('projects/') && !taskId.includes('operations/');

    if (isKling || provider === 'kling') {
      // ========================================
      // Kling AI 상태 확인
      // ========================================
      console.log('Checking Kling AI status...');

      if (!KLING_ACCESS_KEY || !KLING_ACCESS_SECRET) {
        return res.status(500).json({ error: 'Kling AI credentials not configured' });
      }

      const now = Math.floor(Date.now() / 1000);
      const klingToken = jwt.sign(
        {
          iss: KLING_ACCESS_KEY,
          exp: now + 1800,
          nbf: now - 5,
        },
        KLING_ACCESS_SECRET,
        { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
      );

      const klingResponse = await fetch(`https://api.klingai.com/v1/videos/image2video/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${klingToken}`,
        },
      });

      const klingData = await klingResponse.json();
      console.log('Kling response:', JSON.stringify(klingData, null, 2));

      if (!klingResponse.ok || klingData.code !== 0) {
        return res.status(200).json({
          id: taskId,
          status: 'failed',
          error: klingData.message || 'Kling API error',
          provider: 'kling'
        });
      }

      const task = klingData.data;
      let status = 'processing';
      let videoUrl = null;

      if (task.task_status === 'succeed') {
        status = 'succeeded';
        // 비디오 URL 추출
        if (task.task_result?.videos?.[0]?.url) {
          videoUrl = task.task_result.videos[0].url;
        }
      } else if (task.task_status === 'failed') {
        status = 'failed';
      }

      return res.status(200).json({
        id: taskId,
        status: status,
        output: videoUrl,
        error: task.task_status_msg,
        provider: 'kling'
      });

    } else {
      // ========================================
      // Google Veo 상태 확인
      // ========================================
      console.log('Checking Google Veo status...');

      if (!credentials) {
        return res.status(500).json({ error: 'Google Cloud credentials not configured' });
      }

      const auth = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });

      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();

      const modelMatch = taskId.match(/models\/([^\/]+)\/operations/);
      const modelName = modelMatch ? modelMatch[1] : 'veo-2.0-generate-001';

      const statusResponse = await fetch(
        `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelName}:fetchPredictOperation`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            operationName: taskId
          }),
        }
      );

      const contentType = statusResponse.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return res.status(500).json({ 
          error: 'Invalid API response',
          details: 'Google API returned non-JSON response'
        });
      }

      const statusData = await statusResponse.json();

      if (!statusResponse.ok) {
        return res.status(statusResponse.status).json({ 
          error: 'Veo API error',
          details: statusData.error?.message
        });
      }

      let status = 'processing';
      let videoUrl = null;

      if (statusData.done === true) {
        if (statusData.response?.raiMediaFilteredCount > 0) {
          return res.status(200).json({
            id: taskId,
            status: 'failed',
            error: 'Google 안전 필터에 의해 차단되었습니다.',
            provider: 'google-veo'
          });
        }

        if (statusData.error) {
          status = 'failed';
        } else {
          status = 'succeeded';

          // 비디오 추출
          const possiblePaths = [
            statusData.response?.predictions,
            statusData.response?.videos,
            statusData.response?.generatedSamples,
          ];

          for (const path of possiblePaths) {
            if (path && Array.isArray(path) && path.length > 0) {
              const video = path[0];
              if (video.bytesBase64Encoded) {
                const mimeType = video.mimeType || 'video/mp4';
                videoUrl = `data:${mimeType};base64,${video.bytesBase64Encoded}`;
              } else if (video.gcsUri) {
                const gcsUri = video.gcsUri;
                const bucket = gcsUri.replace('gs://', '').split('/')[0];
                const path = gcsUri.replace(`gs://${bucket}/`, '');
                videoUrl = `https://storage.googleapis.com/${bucket}/${path}`;
              }
              break;
            }
          }
        }
      }

      return res.status(200).json({
        id: taskId,
        status: status,
        output: videoUrl,
        error: statusData.error?.message,
        provider: 'google-veo'
      });
    }

  } catch (error) {
    console.error('Status check error:', error);
    return res.status(500).json({ 
      error: 'Failed to check status',
      details: error.message 
    });
  }
}
