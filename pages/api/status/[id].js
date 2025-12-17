import RunwayML from '@runwayml/sdk';

// Runway API 키
const runwayApiKey = (process.env.RUNWAY_API_KEY || '').replace(/^\uFEFF/, '').trim();

const runway = new RunwayML({ apiKey: runwayApiKey });

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Task ID is required' });
  }

  try {
    // Runway task 상태 확인
    const task = await runway.tasks.retrieve(id);

    // Runway 상태를 표준화된 형식으로 변환
    let status = task.status;
    if (status === 'SUCCEEDED') status = 'succeeded';
    if (status === 'FAILED') status = 'failed';
    if (status === 'RUNNING' || status === 'PENDING') status = 'processing';

    return res.status(200).json({
      id: task.id,
      status: status,
      output: task.output?.[0] || task.output,  // 영상 URL
      error: task.failure || null,
      progress: task.progress || 0,
    });

  } catch (error) {
    console.error('Runway Status check error:', error);
    return res.status(500).json({ 
      error: 'Failed to check status',
      details: error.message 
    });
  }
}

