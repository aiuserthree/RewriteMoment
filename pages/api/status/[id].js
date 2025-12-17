import crypto from 'crypto';

// Kling AI API 키
const accessKey = (process.env.KLING_ACCESS_KEY || '').replace(/^\uFEFF/, '').trim();
const secretKey = (process.env.KLING_SECRET_KEY || '').replace(/^\uFEFF/, '').trim();

// JWT 토큰 생성 함수 (Kling AI 인증용)
function generateKlingToken() {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: accessKey,
    exp: now + 1800, // 30분 유효
    nbf: now - 5
  };
  
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');
  
  return `${base64Header}.${base64Payload}.${signature}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Task ID is required' });
  }

  try {
    // JWT 토큰 생성
    const token = generateKlingToken();

    // Kling AI 상태 확인 API 호출
    const klingResponse = await fetch(`https://api.klingai.com/v1/videos/image2video/${id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    const klingData = await klingResponse.json();

    if (!klingResponse.ok) {
      console.error('Kling Status API Error:', klingData);
      return res.status(klingResponse.status).json({ 
        error: 'Kling API error',
        details: klingData.message || JSON.stringify(klingData)
      });
    }

    console.log('Kling Status:', klingData);

    // Kling 상태를 표준 형식으로 변환
    // Kling 상태: submitted, processing, succeed, failed
    const statusMap = {
      'submitted': 'starting',
      'processing': 'processing',
      'succeed': 'succeeded',
      'failed': 'failed'
    };

    const task = klingData.data;
    const status = statusMap[task?.task_status] || task?.task_status;

    // 비디오 URL 추출
    let videoUrl = null;
    if (task?.task_status === 'succeed' && task?.task_result?.videos?.length > 0) {
      videoUrl = task.task_result.videos[0].url;
    }

    return res.status(200).json({
      id: task?.task_id,
      status: status,
      output: videoUrl,
      error: task?.task_status_msg,
      metrics: {
        created_at: task?.created_at,
        updated_at: task?.updated_at
      },
      provider: 'kling'
    });

  } catch (error) {
    console.error('Status check error:', error);
    return res.status(500).json({ 
      error: 'Failed to check status',
      details: error.message 
    });
  }
}

